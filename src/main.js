/**
 * Cyberlove POC entrypoint.
 *
 * Usage:
 * npm install
 * npm run dev
 *
 * Level config shape example:
 * {
 *   id: 1,
 *   target: { distance, chrono, score, boysHit, girlsHit },
 *   lose: { boysHit, girlsHit },
 *   texts: { objective, win, lose, nextLevel, retry },
 *   init: {
 *     player: { moveSpeed: 20 },
 *     crowd: { maxAgents: 80 }
 *   }
 * }
 */
import "./styles.css"
import * as THREE from "three"
import { RendererApp } from "./render/rendererApp.js"
import { PlayerController } from "./player/playerController.js"
import { CameraRig } from "./camera/cameraRig.js"
import { ProceduralCity } from "./world/proceduralCity.js"
import { CrowdSystem } from "./crowd/crowdSystem.js"
import { FlyingCarsSystem } from "./flyingCars/flyingCarsSystem.js"
import { DevTuningManager } from "./dev/devTuningManager.js"
import { DevPalette } from "./dev/devPalette.js"
import { AudioSystem } from "./audio/audioSystem.js"
import { gameConfig } from "./config/gameConfig.js"
import { loadGameLevels, normalizeLevelDefinition } from "./levels/levelLoader.js"

const DEV_MODE_STORAGE_KEY = "cyberlove-dev-mode-v1"
/**
 * Game orchestrator.
 */
class CyberStreet {
  /**
   * @param {HTMLElement} appElement
   * @param {DevTuningManager} tuningManager
   * @param {object[]} levels
   */
  constructor(appElement, tuningManager, levels = []) {
    this.appElement = appElement
    this.tuningManager = tuningManager
    this.devPalette = null
    this.rendererApp = new RendererApp(appElement)
    this.player = new PlayerController(this.rendererApp.scene, this.rendererApp.getDomElement(), this.rendererApp.camera)
    this.cameraRig = new CameraRig(this.rendererApp.camera, this.rendererApp.getDomElement(), this.player.mesh)
    gameConfig.world.seed = _createRuntimeWorldSeed()
    this.proceduralCity = new ProceduralCity(this.rendererApp.scene)
    this.audioSystem = new AudioSystem()
    this.audioSystem.setVolumesFromPercent(gameConfig.sound.musicVolume, gameConfig.sound.hitVolume)
    this.crowd = new CrowdSystem(this.rendererApp.scene, {
      onNpcHit: (hitPayload) => this._handleNpcHit(hitPayload)
    })
    this.flyingCars = new FlyingCarsSystem(this.rendererApp.scene)
    this.raycaster = new THREE.Raycaster()
    this.pointerNdc = new THREE.Vector2()
    this.pointerInteractionState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastInteractionTs: 0
    }
    this.score = 0
    this.girlHits = 0
    this.boyHits = 0
    this.distanceMeters = 0
    this.maxDistanceMeters = 0
    this.isHitCountingEnabledForFrame = false
    this.levelElapsedMs = 0
    this.levels = this._resolveLevels(levels)
    this.currentLevelIndex = 0
    this.gameState = "intro"
    this.pendingResult = null
    this.scoreElement = document.getElementById("scoreValue")
    this.distanceElement = document.getElementById("distanceValue")
    this.chronoHudElement = document.getElementById("chronoHud")
    this.chronoValueElement = document.getElementById("chronoValue")
    this.girlHitsElement = document.getElementById("girlHitsValue")
    this.boyHitsElement = document.getElementById("boyHitsValue")
    this.levelOverlayElement = document.getElementById("levelOverlay")
    this.levelOverlayTitleElement = document.getElementById("levelOverlayTitle")
    this.levelOverlayTextElement = document.getElementById("levelOverlayText")
    this.levelOverlayHintElement = document.getElementById("levelOverlayHint")
    this.levelOverlayActionElement = document.getElementById("levelOverlayAction")
    this.startPlayerPosition = this.player.mesh.position.clone()
    this.proceduralCity.applyDayNightProfile(this.rendererApp.getSkyProfile())
    this.baseRuntimeProfile = tuningManager.getProfileClone()
    this.lastLiveProfile = this._cloneProfile(this.baseRuntimeProfile)
    this.lastFrameTime = performance.now()
    this.isRunning = true

    this._renderScore()
    this._renderHitCounters()
    this._renderDistance(this.player.mesh.position)
    this._renderChronoHud()
    this._bindLevelOverlayEvents()
    this._startCurrentLevel()
    this._bindInteractionHandlers()
    this._bindInteractionEvents()
    this.audioSystem.attachUnlockListeners(window)
    this._loop = this._loop.bind(this)
    this._loop()
  }

  /**
   * Attach optional dev palette instance for disposal lifecycle.
   * @param {DevPalette} devPalette
   * @returns {void}
   */
  setDevPalette(devPalette) {
    this.devPalette = devPalette
  }

  /**
   * Return a clone of the active level definition.
   * @returns {object}
   */
  getCurrentLevelDefinitionClone() {
    return this._cloneProfile(this._getCurrentLevelDefinition())
  }

  /**
   * Start a level directly from its configured id.
   * @param {number} levelId
   * @returns {void}
   */
  testLevelById(levelId) {
    const normalizedLevelId = Math.max(1, Math.round(Number(levelId) || 1))
    const foundLevelIndex = this.levels.findIndex((levelDefinition) => Number(levelDefinition?.id) === normalizedLevelId)
    if (foundLevelIndex >= 0) {
      this.currentLevelIndex = foundLevelIndex
      this._startCurrentLevel()
      return this.getCurrentLevelDefinitionClone()
    }

    const fallbackLevelIndex = normalizedLevelId - 1
    if (this.levels[fallbackLevelIndex]) {
      this.currentLevelIndex = fallbackLevelIndex
      this._startCurrentLevel()
      return this.getCurrentLevelDefinitionClone()
    }

    this.currentLevelIndex = 0
    this._startCurrentLevel()
    return this.getCurrentLevelDefinitionClone()
  }

  /**
   * Move to previous/next level with wrap-around and start it.
   * @param {number} step
   * @returns {object}
   */
  cycleLevel(step) {
    const levelCount = this.levels.length
    if (levelCount <= 0) {
      return this.getCurrentLevelDefinitionClone()
    }

    const normalizedStep = Math.round(Number(step) || 0)
    if (normalizedStep === 0) {
      return this.getCurrentLevelDefinitionClone()
    }

    let nextLevelIndex = (this.currentLevelIndex + normalizedStep) % levelCount
    if (nextLevelIndex < 0) {
      nextLevelIndex += levelCount
    }

    this.currentLevelIndex = nextLevelIndex
    this._startCurrentLevel()
    return this.getCurrentLevelDefinitionClone()
  }

  /**
   * Save one complete level JSON and restart the current level for immediate testing.
   * @param {object} nextLevelDefinition
   * @param {object} profile
   * @returns {void}
   */
  saveLevelAndRestart(nextLevelDefinition, profile) {
    const normalizedLevelDefinition = normalizeLevelDefinition(nextLevelDefinition, this._getCurrentLevelDefinition().id)
    normalizedLevelDefinition.init = this._extractCurrentValuesFromProfile(profile)
    const targetLevelIndex = this.levels.findIndex((levelDefinition) => levelDefinition.id === normalizedLevelDefinition.id)
    if (targetLevelIndex >= 0) {
      this.levels[targetLevelIndex] = normalizedLevelDefinition
      this.currentLevelIndex = targetLevelIndex
    } else {
      this.levels.push(normalizedLevelDefinition)
      this.levels.sort((leftLevel, rightLevel) => leftLevel.id - rightLevel.id)
      this.currentLevelIndex = this.levels.findIndex((levelDefinition) => levelDefinition.id === normalizedLevelDefinition.id)
    }

    this._downloadLevelAsJson(normalizedLevelDefinition)
    this._applyRuntimeProfile(profile, true)
    this._startCurrentLevel()
  }

  /**
   * Bind overlay input events used by level intro and results.
   * @returns {void}
   */
  _bindLevelOverlayEvents() {
    this._onOverlayKeyDown = this._onOverlayKeyDown.bind(this)
    this._onOverlayActionClick = this._onOverlayActionClick.bind(this)
    this._onOverlayPointerDown = this._onOverlayPointerDown.bind(this)
    window.addEventListener("keydown", this._onOverlayKeyDown)
    this.levelOverlayActionElement?.addEventListener("click", this._onOverlayActionClick)
    this.levelOverlayElement?.addEventListener("pointerdown", this._onOverlayPointerDown)
  }

  /**
   * Normalize initial levels list and guarantee at least one level.
   * @param {object[]} levels
   * @returns {object[]}
   */
  _resolveLevels(levels) {
    if (!Array.isArray(levels) || levels.length <= 0) {
      return [normalizeLevelDefinition({}, 1)]
    }

    const normalizedLevels = levels.map((levelDefinition, arrayIndex) => normalizeLevelDefinition(levelDefinition, arrayIndex + 1))
    return normalizedLevels.sort((leftLevel, rightLevel) => leftLevel.id - rightLevel.id)
  }

  /**
   * Start the currently selected level from intro state.
   * @returns {void}
   */
  _startCurrentLevel() {
    const levelDefinition = this._getCurrentLevelDefinition()
    const levelRuntimeProfile = this._buildLevelRuntimeProfile(levelDefinition)
    this._applyRuntimeProfile(levelRuntimeProfile, false)
    this._resetPlayerAndSystemsForLevel()
    this._resetRunStats()
    this._showLevelIntro(levelDefinition)
  }

  /**
   * Return the active level definition.
   * @returns {object}
   */
  _getCurrentLevelDefinition() {
    return this.levels[this.currentLevelIndex] ?? this.levels[this.levels.length - 1]
  }

  /**
   * Resolve one numeric target threshold from level definition.
   * @param {object} levelDefinition
   * @param {string} targetKey
   * @returns {number}
   */
  _getLevelTargetThreshold(levelDefinition, targetKey) {
    const rawValue = levelDefinition?.target?.[targetKey]
    return this._getActiveLevelThreshold(rawValue)
  }

  /**
   * Resolve one numeric lose threshold from level definition.
   * @param {object} levelDefinition
   * @param {string} loseKey
   * @returns {number}
   */
  _getLevelLoseThreshold(levelDefinition, loseKey) {
    const rawValue = levelDefinition?.lose?.[loseKey]
    return this._getActiveLevelThreshold(rawValue)
  }

  /**
   * Resolve one UI text from level definition.
   * @param {object} levelDefinition
   * @param {string} textKey
   * @returns {string}
   */
  _getLevelText(levelDefinition, textKey) {
    return String(levelDefinition?.texts?.[textKey] ?? "").trim()
  }

  /**
   * Build runtime profile by merging base tuning with level init overrides.
   * @param {object} levelDefinition
   * @returns {object}
   */
  _buildLevelRuntimeProfile(levelDefinition) {
    const runtimeProfile = this._cloneProfile(this.baseRuntimeProfile)
    const levelInitValues = levelDefinition?.init ?? {}
    this._mergeLevelInitIntoProfile(runtimeProfile, levelInitValues)
    return runtimeProfile
  }

  /**
   * Merge level init values into a tuning profile with schema-aware filtering.
   * @param {object} profile
   * @param {object} levelInitValues
   * @returns {void}
   */
  _mergeLevelInitIntoProfile(profile, levelInitValues) {
    if (!levelInitValues || typeof levelInitValues !== "object") {
      return
    }

    for (const [sectionKey, sectionValues] of Object.entries(levelInitValues)) {
      if (!sectionValues || typeof sectionValues !== "object") {
        continue
      }

      const profileSection = profile?.[sectionKey]
      if (!profileSection || typeof profileSection !== "object") {
        console.warn(`Unknown level init section "${sectionKey}" ignored`)
        continue
      }

      for (const [paramKey, rawValue] of Object.entries(sectionValues)) {
        const parameterSchema = profileSection[paramKey]
        if (!parameterSchema || typeof parameterSchema !== "object" || !("current" in parameterSchema)) {
          console.warn(`Unknown level init parameter "${sectionKey}.${paramKey}" ignored`)
          continue
        }

        parameterSchema.current = rawValue
      }
    }
  }

  /**
   * Reset score and counters for a fresh level attempt.
   * @returns {void}
   */
  _resetRunStats() {
    this.score = 0
    this.girlHits = 0
    this.boyHits = 0
    this.distanceMeters = 0
    this.maxDistanceMeters = 0
    this.isHitCountingEnabledForFrame = false
    this.levelElapsedMs = 0
    this._renderScore()
    this._renderHitCounters()
    this._renderDistance(this.player.mesh.position)
    this._renderChronoHud()
  }

  /**
   * Reset player position and recreate dynamic systems for a level restart.
   * @returns {void}
   */
  _resetPlayerAndSystemsForLevel() {
    this.player.resetState(this.startPlayerPosition)
    this._recreateCrowdSystem()
    this._recreateFlyingCarsSystem()
    this.startPlayerPosition.copy(this.player.mesh.position)
    this._renderDistance(this.player.mesh.position)
    this.lastFrameTime = performance.now()
  }

  /**
   * Show level objective panel and pause gameplay until user input.
   * @param {object} levelDefinition
   * @returns {void}
   */
  _showLevelIntro(levelDefinition) {
    this.gameState = "intro"
    this.pendingResult = null
    this._setOverlayContent({
      title: `Level ${levelDefinition.id}`,
      text: this._buildLevelObjectiveText(levelDefinition),
      hint: "Appuyez sur une touche pour démarrer",
      actionLabel: ""
    })
  }

  /**
   * Enter active gameplay state and hide overlay.
   * @returns {void}
   */
  _startGameplay() {
    if (this.gameState !== "intro") {
      return
    }

    this.levelElapsedMs = 0
    this.isHitCountingEnabledForFrame = false
    this.gameState = "playing"
    this._renderChronoHud()
    this._hideOverlay()
    this.lastFrameTime = performance.now()
  }

  /**
   * Build intro objective block with automatically generated active targets.
   * @param {object} levelDefinition
   * @returns {string}
   */
  _buildLevelObjectiveText(levelDefinition) {
    const objectiveLines = []
    const targetBoysHit = this._getLevelTargetThreshold(levelDefinition, "boysHit")
    const targetGirlsHit = this._getLevelTargetThreshold(levelDefinition, "girlsHit")
    const targetScore = this._getLevelTargetThreshold(levelDefinition, "score")
    const targetDistance = this._getLevelTargetThreshold(levelDefinition, "distance")
    const targetChrono = this._getLevelTargetThreshold(levelDefinition, "chrono")

    if (targetBoysHit > 0) {
      objectiveLines.push(`Boyz à baffer : ${targetBoysHit}`)
    }

    if (targetGirlsHit > 0) {
      objectiveLines.push(`Girlz à baffer : ${targetGirlsHit}`)
    }

    if (targetScore > 0) {
      objectiveLines.push(`Score cible : ${targetScore}`)
    }

    if (targetDistance > 0) {
      objectiveLines.push(`Parcours ${this._formatIntegerWithSpacing(targetDistance)}m`)
    }

    if (targetChrono > 0) {
      objectiveLines.push(`T'as exactement ${this._formatChronoSeconds(targetChrono)} secondes !`)
    }

    const baseText = this._getLevelText(levelDefinition, "objective")
    if (objectiveLines.length <= 0) {
      return baseText
    }

    if (!baseText) {
      return objectiveLines.join("\n")
    }

    return `${baseText}\n\n${objectiveLines.join("\n")}`
  }

  /**
   * Parse one level threshold and clamp it to a non-negative integer.
   * @param {unknown} rawValue
   * @returns {number}
   */
  _getActiveLevelThreshold(rawValue) {
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) {
      return 0
    }

    return Math.max(0, Math.round(numericValue))
  }

  /**
   * Format integer with spaces as thousands separators.
   * @param {number} value
   * @returns {string}
   */
  _formatIntegerWithSpacing(value) {
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  }

  /**
   * Format milliseconds to seconds string for objective text.
   * @param {number} milliseconds
   * @returns {string}
   */
  _formatChronoSeconds(milliseconds) {
    const seconds = milliseconds / 1000
    if (Math.abs(seconds - Math.round(seconds)) < 0.0001) {
      return String(Math.round(seconds))
    }

    return seconds.toFixed(1)
  }

  /**
   * Finish current level run and show result screen.
   * @param {boolean} isWin
   * @param {string} message
   * @returns {void}
   */
  _finishLevel(isWin, message) {
    if (this.gameState !== "playing") {
      return
    }

    const levelDefinition = this._getCurrentLevelDefinition()
    this.gameState = "result"
    this.pendingResult = isWin ? "win" : "lose"
    this._setOverlayContent({
      title: isWin ? "Victoire" : "Perdu",
      text: message,
      hint: "",
      actionLabel: isWin ? this._getLevelText(levelDefinition, "nextLevel") : this._getLevelText(levelDefinition, "retry")
    })
    this._renderChronoHud()
  }

  /**
   * Advance to next level or loop to first one after final win.
   * @returns {void}
   */
  _continueAfterWin() {
    const nextLevelIndex = this.currentLevelIndex + 1
    if (nextLevelIndex >= this.levels.length) {
      this.currentLevelIndex = 0
    } else {
      this.currentLevelIndex = nextLevelIndex
    }
    this._startCurrentLevel()
  }

  /**
   * Handle keyboard input for intro overlay.
   * @returns {void}
   */
  _onOverlayKeyDown() {
    this._startGameplay()
  }

  /**
   * Handle pointer/touch press on overlay during intro.
   * @returns {void}
   */
  _onOverlayPointerDown() {
    this._startGameplay()
  }

  /**
   * Handle overlay action button click for win/lose states.
   * @returns {void}
   */
  _onOverlayActionClick() {
    if (this.pendingResult === "lose") {
      this._startCurrentLevel()
      return
    }

    if (this.pendingResult === "win") {
      this._continueAfterWin()
    }
  }

  /**
   * Update overlay title/text/hint/button according to current state.
   * @param {object} content
   * @param {string} content.title
   * @param {string} content.text
   * @param {string} content.hint
   * @param {string} content.actionLabel
   * @returns {void}
   */
  _setOverlayContent(content) {
    if (!this.levelOverlayElement) {
      return
    }

    this.levelOverlayTitleElement.textContent = content.title
    this.levelOverlayTextElement.textContent = content.text
    this.levelOverlayHintElement.textContent = content.hint
    const hasAction = Boolean(content.actionLabel)
    this.levelOverlayActionElement.textContent = content.actionLabel
    this.levelOverlayActionElement.style.display = hasAction ? "inline-flex" : "none"
    this.levelOverlayElement.classList.remove("level-overlay-hidden")
  }

  /**
   * Hide overlay element.
   * @returns {void}
   */
  _hideOverlay() {
    if (!this.levelOverlayElement) {
      return
    }

    this.levelOverlayElement.classList.add("level-overlay-hidden")
  }

  /**
   * Apply tuning profile live and refresh dynamic systems.
   * @param {object} profile
   * @returns {void}
   */
  applyLiveTuning(profile) {
    this._applyRuntimeProfile(profile, true)
  }

  /**
   * Apply one runtime profile and refresh dependent systems.
   * @param {object} profile
   * @param {boolean} shouldPersistAsBaseProfile
   * @returns {void}
   */
  _applyRuntimeProfile(profile, shouldPersistAsBaseProfile = false) {
    this.tuningManager.applyProfileLive(profile)
    const skyProfile = this.rendererApp.applyRuntimeTuning()
    this.player.applyRuntimeTuning()
    this.audioSystem.setVolumesFromPercent(gameConfig.sound.musicVolume, gameConfig.sound.hitVolume)
    this._renderScore()
    this._renderDistance(this.player.mesh.position)

    const shouldRecreateProceduralCity = this._hasLiveSectionChanged(profile, "buildings") ||
      this._hasLiveSectionChanged(profile, "stands") ||
      this._hasLiveSectionChanged(profile, "clouds") ||
      this._hasLiveSectionChanged(profile, "world")
    const shouldRecreateCrowd = this._hasLiveSectionChanged(profile, "crowd") || this._hasLiveSectionChanged(profile, "buildings")
    const shouldRecreateFlyingCars = this._hasLiveSectionChanged(profile, "flyingCars")

    if (shouldRecreateProceduralCity) {
      this._recreateProceduralCity()
    }

    if (shouldRecreateCrowd) {
      this._recreateCrowdSystem()
    }

    if (shouldRecreateFlyingCars) {
      this._recreateFlyingCarsSystem()
    }

    this.proceduralCity.applyDayNightProfile(skyProfile)

    this.lastLiveProfile = this._cloneProfile(profile)
    if (shouldPersistAsBaseProfile) {
      this.baseRuntimeProfile = this._cloneProfile(profile)
    }
  }

  /**
   * Stop the simulation and release resources.
   * @returns {void}
   */
  dispose() {
    this.isRunning = false
    this._unbindInteractionEvents()
    window.removeEventListener("keydown", this._onOverlayKeyDown)
    this.levelOverlayActionElement?.removeEventListener("click", this._onOverlayActionClick)
    this.devPalette?.dispose()
    this.crowd.dispose()
    this.audioSystem.dispose()
    this.flyingCars.dispose()
    this.proceduralCity.dispose()
    this.cameraRig.dispose()
    this.player.dispose()
    this.rendererApp.dispose()
  }

  /**
   * Recreate only procedural city chunks and visuals.
   * @returns {void}
   */
  _recreateProceduralCity() {
    this.proceduralCity.dispose()
    this.proceduralCity = new ProceduralCity(this.rendererApp.scene)
    this.proceduralCity.applyDayNightProfile(this.rendererApp.getSkyProfile())
    this.proceduralCity.update(this.player.mesh.position.z)
  }

  /**
   * Recreate only crowd simulation and rendering.
   * @returns {void}
   */
  _recreateCrowdSystem() {
    this.crowd.dispose()
    this.crowd = new CrowdSystem(this.rendererApp.scene, {
      onNpcHit: (hitPayload) => this._handleNpcHit(hitPayload)
    })
    this.crowd.update(0, this.player.mesh.position, this.player.forwardVector.z)
  }

  /**
   * Handle one NPC hit event: play SFX and update score by NPC variant.
   * @param {object} hitPayload
   * @returns {void}
   */
  _handleNpcHit(hitPayload) {
    if (this.gameState !== "playing") {
      return
    }

    this.audioSystem.playHitSound()
    if (!this.isHitCountingEnabledForFrame) {
      return
    }

    const isGirlHit = hitPayload?.bodyVariant === "pink"
    const hitScoreDelta = isGirlHit ? -10 : 10
    this.score = Math.max(0, this.score + hitScoreDelta)
    if (isGirlHit) {
      this.girlHits += 1
    } else {
      this.boyHits += 1
    }
    this._renderScore()
    this._renderHitCounters()

    const levelDefinition = this._getCurrentLevelDefinition()
    const loseOnGirlHitThreshold = this._getLevelLoseThreshold(levelDefinition, "girlsHit")
    const loseOnBoyHitThreshold = this._getLevelLoseThreshold(levelDefinition, "boysHit")
    if (isGirlHit && loseOnGirlHitThreshold > 0 && this.girlHits >= loseOnGirlHitThreshold) {
      this._finishLevel(false, this._getLevelText(levelDefinition, "lose"))
      return
    }

    if (!isGirlHit && loseOnBoyHitThreshold > 0 && this.boyHits >= loseOnBoyHitThreshold) {
      this._finishLevel(false, this._getLevelText(levelDefinition, "lose"))
    }
  }

  /**
   * Check whether player is currently moving backward.
   * @returns {boolean}
   */
  _isPlayerMovingBackward() {
    const forwardVelocity = Number(this.player?.velocity?.forward ?? 0)
    return forwardVelocity < -0.05
  }

  /**
   * Render score value into HUD if score element exists.
   * @returns {void}
   */
  _renderScore() {
    if (!this.scoreElement) {
      return
    }

    this.scoreElement.textContent = String(this.score)
    this._syncHudTypography()
  }

  /**
   * Render girls and boys hit counters in HUD.
   * @returns {void}
   */
  _renderHitCounters() {
    if (this.girlHitsElement) {
      this.girlHitsElement.textContent = String(this.girlHits)
    }

    if (this.boyHitsElement) {
      this.boyHitsElement.textContent = String(this.boyHits)
    }

    this._syncHudTypography()
  }

  /**
   * Render traveled distance from start position using configurable scale.
   * @param {THREE.Vector3} playerPosition
   * @returns {void}
   */
  _renderDistance(playerPosition) {
    if (!this.distanceElement) {
      return
    }

    const currentDisplayDistance = this._computeDisplayDistance(playerPosition)
    this.maxDistanceMeters = Math.max(this.maxDistanceMeters, currentDisplayDistance)
    this.distanceMeters = this.maxDistanceMeters
    this.distanceElement.textContent = `${this.distanceMeters.toFixed(1)} m`
    this._syncHudTypography()
  }

  /**
   * Render centered countdown HUD when current level has a chrono target.
   * @returns {void}
   */
  _renderChronoHud() {
    if (!this.chronoHudElement || !this.chronoValueElement) {
      return
    }

    const levelDefinition = this._getCurrentLevelDefinition()
    const targetChrono = this._getLevelTargetThreshold(levelDefinition, "chrono")
    const shouldShowChrono = this.gameState === "playing" && targetChrono > 0
    this.chronoHudElement.classList.toggle("chrono-hud-hidden", !shouldShowChrono)
    if (!shouldShowChrono) {
      return
    }

    const remainingMilliseconds = Math.max(0, targetChrono - this.levelElapsedMs)
    this.chronoValueElement.textContent = this._formatCountdownTime(remainingMilliseconds)
  }

  /**
   * Format remaining countdown milliseconds to display string.
   * @param {number} remainingMilliseconds
   * @returns {string}
   */
  _formatCountdownTime(remainingMilliseconds) {
    const clampedMilliseconds = Math.max(0, remainingMilliseconds)
    const totalTenths = Math.ceil(clampedMilliseconds / 100)
    const minutes = Math.floor(totalTenths / 600)
    const seconds = Math.floor((totalTenths % 600) / 10)
    const tenths = totalTenths % 10

    if (minutes > 0) {
      const minuteText = String(minutes).padStart(2, "0")
      const secondText = String(seconds).padStart(2, "0")
      return `${minuteText}:${secondText}.${tenths}`
    }

    return `${seconds}.${tenths}s`
  }

  /**
   * Sync score and distance font sizes from player HUD settings.
   * @returns {void}
   */
  _syncHudTypography() {
    const scoreSize = Math.max(10, gameConfig.player.scoreSize)
    const distanceSize = Math.max(8, scoreSize * 0.5)
    if (this.scoreElement) {
      this.scoreElement.style.fontSize = `${scoreSize}px`
    }
    if (this.distanceElement) {
      this.distanceElement.style.fontSize = `${distanceSize}px`
    }

    if (this.girlHitsElement) {
      this.girlHitsElement.style.fontSize = `${distanceSize}px`
    }

    if (this.boyHitsElement) {
      this.boyHitsElement.style.fontSize = `${distanceSize}px`
    }
  }

  /**
   * Compute planar distance from starting point.
   * @param {THREE.Vector3} playerPosition
   * @returns {number}
   */
  _computeDistanceFromStart(playerPosition) {
    const deltaX = playerPosition.x - this.startPlayerPosition.x
    const deltaZ = playerPosition.z - this.startPlayerPosition.z
    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)
  }

  /**
   * Compute displayed distance using current runtime coefficient.
   * @param {THREE.Vector3} playerPosition
   * @returns {number}
   */
  _computeDisplayDistance(playerPosition) {
    const distanceFromStart = this._computeDistanceFromStart(playerPosition)
    const distanceCoef = Math.max(0, gameConfig.player.distanceCoef)
    return distanceFromStart * distanceCoef
  }

  /**
   * Recreate only flying cars simulation and rendering.
   * @returns {void}
   */
  _recreateFlyingCarsSystem() {
    this.flyingCars.dispose()
    this.flyingCars = new FlyingCarsSystem(this.rendererApp.scene)
    this.flyingCars.update(0, this.player.mesh.position)
  }

  /**
   * Bind interaction handlers to class scope.
   * @returns {void}
   */
  _bindInteractionHandlers() {
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onPointerCancel = this._onPointerCancel.bind(this)
    this._onCanvasClick = this._onCanvasClick.bind(this)
  }

  /**
   * Register interaction events.
   * @returns {void}
   */
  _bindInteractionEvents() {
    const domElement = this.rendererApp.getDomElement()
    domElement.addEventListener("pointerdown", this._onPointerDown)
    domElement.addEventListener("pointerup", this._onPointerUp)
    domElement.addEventListener("pointercancel", this._onPointerCancel)
    domElement.addEventListener("click", this._onCanvasClick)
    window.addEventListener("pointerup", this._onPointerUp)
  }

  /**
   * Remove interaction events.
   * @returns {void}
   */
  _unbindInteractionEvents() {
    const domElement = this.rendererApp.getDomElement()
    domElement.removeEventListener("pointerdown", this._onPointerDown)
    domElement.removeEventListener("pointerup", this._onPointerUp)
    domElement.removeEventListener("pointercancel", this._onPointerCancel)
    domElement.removeEventListener("click", this._onCanvasClick)
    window.removeEventListener("pointerup", this._onPointerUp)
  }

  /**
   * Capture pointer start position to validate click-like interactions.
   * @param {PointerEvent} event
   * @returns {void}
   */
  _onPointerDown(event) {
    this.audioSystem.notifyUserGesture()
    if (event.button !== 0) {
      return
    }

    const domElement = this.rendererApp.getDomElement()
    if (domElement.setPointerCapture) {
      domElement.setPointerCapture(event.pointerId)
    }

    this.pointerInteractionState.active = true
    this.pointerInteractionState.pointerId = event.pointerId
    this.pointerInteractionState.startX = event.clientX
    this.pointerInteractionState.startY = event.clientY
  }

  /**
   * Handle pointer interaction with crowd NPC instances.
   * @param {PointerEvent} event
   * @returns {void}
   */
  _onPointerUp(event) {
    if (!this.pointerInteractionState.active) {
      return
    }

    const isSamePointer = this.pointerInteractionState.pointerId === event.pointerId
    this.pointerInteractionState.active = false
    this.pointerInteractionState.pointerId = null
    if (!isSamePointer) {
      return
    }

    const deltaX = event.clientX - this.pointerInteractionState.startX
    const deltaY = event.clientY - this.pointerInteractionState.startY
    const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const maxTapDistance = 16
    if (dragDistance > maxTapDistance) {
      return
    }

    this.pointerInteractionState.lastInteractionTs = performance.now()
    this._tryInteractWithNpcAt(event.clientX, event.clientY)
  }

  /**
   * Clear pointer interaction state when browser cancels the pointer stream.
   * @returns {void}
   */
  _onPointerCancel() {
    this.pointerInteractionState.active = false
    this.pointerInteractionState.pointerId = null
  }

  /**
   * Fallback click interaction for desktop when pointer sequence is not delivered.
   * @param {MouseEvent} event
   * @returns {void}
   */
  _onCanvasClick(event) {
    this.audioSystem.notifyUserGesture()
    const now = performance.now()
    if (now - this.pointerInteractionState.lastInteractionTs < 120) {
      return
    }

    this._tryInteractWithNpcAt(event.clientX, event.clientY)
  }

  /**
   * Raycast crowd instances and toggle hit NPC state.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {void}
   */
  _tryInteractWithNpcAt(clientX, clientY) {
    if (this.gameState !== "playing") {
      return
    }

    const domElement = this.rendererApp.getDomElement()
    const canvasRect = domElement.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return
    }

    this.pointerNdc.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1
    this.pointerNdc.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointerNdc, this.rendererApp.camera)
    const intersections = this.raycaster.intersectObjects(this.crowd.getInteractiveMeshes(), false)
    const npcHit = intersections.find((intersection) => Number.isInteger(intersection.instanceId))
    if (!npcHit) {
      return
    }

    this.crowd.toggleNpcInteractionStopByInstanceIndex(npcHit.instanceId)
  }

  /**
   * Check if one profile section changed since previous live state.
   * @param {object} nextProfile
   * @param {string} sectionKey
   * @returns {boolean}
   */
  _hasLiveSectionChanged(nextProfile, sectionKey) {
    const previousSection = this.lastLiveProfile?.[sectionKey] ?? {}
    const nextSection = nextProfile?.[sectionKey] ?? {}
    return JSON.stringify(previousSection) !== JSON.stringify(nextSection)
  }

  /**
   * Deep clone a JSON-compatible profile object.
   * @param {object} profile
   * @returns {object}
   */
  _cloneProfile(profile) {
    return JSON.parse(JSON.stringify(profile))
  }

  /**
   * Extract current values from tuning profile schema.
   * @param {object} profile
   * @returns {object}
   */
  _extractCurrentValuesFromProfile(profile) {
    const result = {}
    if (!profile || typeof profile !== "object") {
      return result
    }

    for (const [sectionKey, sectionValues] of Object.entries(profile)) {
      if (!sectionValues || typeof sectionValues !== "object") {
        continue
      }

      result[sectionKey] = {}
      for (const [paramKey, paramSchema] of Object.entries(sectionValues)) {
        if (!paramSchema || typeof paramSchema !== "object") {
          continue
        }
        result[sectionKey][paramKey] = paramSchema.current
      }
    }

    return result
  }

  /**
   * Download one level definition as JSON file.
   * @param {object} levelDefinition
   * @returns {void}
   */
  _downloadLevelAsJson(levelDefinition) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return
    }

    try {
      const levelId = Math.max(1, Math.round(Number(levelDefinition?.id) || 1))
      const fileName = `level_${String(levelId).padStart(2, "0")}.json`
      const jsonContent = `${JSON.stringify(levelDefinition, null, 2)}\n`
      const fileBlob = new Blob([jsonContent], { type: "application/json;charset=utf-8" })
      const downloadUrl = URL.createObjectURL(fileBlob)
      const downloadLink = document.createElement("a")
      downloadLink.href = downloadUrl
      downloadLink.download = fileName
      downloadLink.style.display = "none"
      document.body.appendChild(downloadLink)
      downloadLink.click()
      document.body.removeChild(downloadLink)
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.warn("Failed to download level json", error)
    }
  }

  /**
   * Main animation loop.
   * @returns {void}
   */
  _loop() {
    if (!this.isRunning) {
      return
    }

    const now = performance.now()
    const deltaTime = Math.min(0.05, (now - this.lastFrameTime) / 1000)
    this.lastFrameTime = now

    if (this.gameState === "playing") {
      const previousMaxDistance = this.maxDistanceMeters
      this.player.update(deltaTime)
      this.levelElapsedMs += deltaTime * 1000
      this._renderDistance(this.player.mesh.position)
      const hasNewDistanceProgress = this.maxDistanceMeters > previousMaxDistance + 0.001
      this.isHitCountingEnabledForFrame = hasNewDistanceProgress && !this._isPlayerMovingBackward()
      this._renderChronoHud()
      this._evaluateLevelCompletion()
      this.proceduralCity.update(this.player.mesh.position.z)
      this.crowd.update(deltaTime, this.player.mesh.position, this.player.forwardVector.z)
      this.flyingCars.update(deltaTime, this.player.mesh.position)
      this.cameraRig.update(deltaTime)
    } else {
      const pausedDeltaTime = 0
      this.isHitCountingEnabledForFrame = false
      this._renderChronoHud()
      this.proceduralCity.update(this.player.mesh.position.z)
      this.crowd.update(pausedDeltaTime, this.player.mesh.position, this.player.forwardVector.z)
      this.flyingCars.update(pausedDeltaTime, this.player.mesh.position)
      this.cameraRig.update(deltaTime)
    }
    this.rendererApp.render()

    requestAnimationFrame(this._loop)
  }

  /**
   * Check whether configured hit objectives are reached for current counters.
   * @param {number} targetGirlsHit
   * @param {number} targetBoysHit
   * @returns {boolean}
   */
  _areHitTargetsReached(targetGirlsHit, targetBoysHit) {
    const isGirlsTargetReached = targetGirlsHit <= 0 || this.girlHits >= targetGirlsHit
    const isBoysTargetReached = targetBoysHit <= 0 || this.boyHits >= targetBoysHit
    return isGirlsTargetReached && isBoysTargetReached
  }

  /**
   * Evaluate active triggers and resolve win/lose with combined victory goals.
   * @returns {void}
   */
  _evaluateLevelCompletion() {
    if (this.gameState !== "playing") {
      return
    }

    const levelDefinition = this._getCurrentLevelDefinition()
    const targetDistance = this._getLevelTargetThreshold(levelDefinition, "distance")
    const targetChrono = this._getLevelTargetThreshold(levelDefinition, "chrono")
    const targetGirlsHit = this._getLevelTargetThreshold(levelDefinition, "girlsHit")
    const targetBoysHit = this._getLevelTargetThreshold(levelDefinition, "boysHit")
    const targetScore = this._getLevelTargetThreshold(levelDefinition, "score")
    const isDistanceTriggerActive = targetDistance > 0
    const isChronoTriggerActive = targetChrono > 0
    const hasImmediateHitWinTrigger = !isDistanceTriggerActive && !isChronoTriggerActive
    const hasAnyHitTarget = targetGirlsHit > 0 || targetBoysHit > 0
    const isHitTargetsReached = this._areHitTargetsReached(targetGirlsHit, targetBoysHit)

    if (hasImmediateHitWinTrigger && hasAnyHitTarget && isHitTargetsReached) {
      this._finishLevel(true, this._getLevelText(levelDefinition, "win"))
      return
    }

    const isDistanceReached = isDistanceTriggerActive && this.distanceMeters >= targetDistance
    const isChronoExpired = isChronoTriggerActive && this.levelElapsedMs >= targetChrono

    if (!isDistanceReached && !isChronoExpired) {
      return
    }

    if (isChronoExpired && isDistanceTriggerActive && !isDistanceReached) {
      this._finishLevel(false, this._getLevelText(levelDefinition, "lose"))
      return
    }

    const isHitTargetReached = this._areHitTargetsReached(targetGirlsHit, targetBoysHit)
    const isScoreTargetReached = targetScore <= 0 || this.score >= targetScore
    const isVictory = isHitTargetReached && isScoreTargetReached
    if (isVictory) {
      this._finishLevel(true, this._getLevelText(levelDefinition, "win"))
      return
    }

    this._finishLevel(false, this._getLevelText(levelDefinition, "lose"))
  }
}

/**
 * Resolve persisted dev mode from URL query and local storage.
 *
 * Usage:
 * const isDevModeEnabled = _resolveDevMode()
 * // URL ?dev=true|false has priority and persists to localStorage
 * @returns {boolean}
 */
function _resolveDevMode() {
  const devQueryValue = _readDevQueryValue()
  if (devQueryValue !== null) {
    _persistDevMode(devQueryValue)
    return devQueryValue
  }

  return _readPersistedDevMode()
}

/**
 * Read and normalize ?dev query value.
 * @returns {boolean | null}
 */
function _readDevQueryValue() {
  const searchParams = new URLSearchParams(window.location.search)
  const rawValue = searchParams.get("dev")
  if (!rawValue) {
    return null
  }

  const normalizedValue = rawValue.trim().toLowerCase()
  if (normalizedValue === "true") {
    return true
  }
  if (normalizedValue === "false") {
    return false
  }
  return null
}

/**
 * Read persisted dev mode from local storage.
 * @returns {boolean}
 */
function _readPersistedDevMode() {
  try {
    const rawValue = window.localStorage.getItem(DEV_MODE_STORAGE_KEY)
    return rawValue === "true"
  } catch (error) {
    console.warn("Failed to read dev mode from storage", error)
    return false
  }
}

/**
 * Persist dev mode state in local storage.
 * @param {boolean} isDevModeEnabled
 * @returns {void}
 */
function _persistDevMode(isDevModeEnabled) {
  try {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, String(isDevModeEnabled))
  } catch (error) {
    console.warn("Failed to persist dev mode in storage", error)
  }
}

/**
 * Create one random world seed for procedural generation.
 * @returns {string}
 */
function _createRuntimeWorldSeed() {
  const randomPart = Math.floor(Math.random() * 1e9).toString(36)
  return `cyberlove-${Date.now().toString(36)}-${randomPart}`
}

const appElement = document.getElementById("app")
if (!appElement) {
  throw new Error("Missing #app element")
}

const hudElement = document.getElementById("hud")
const hudCloseButton = document.getElementById("hudCloseBtn")
if (hudElement && hudCloseButton) {
  hudCloseButton.addEventListener("click", () => {
    hudElement.style.display = "none"
  })
}

const tuningManager = new DevTuningManager()
tuningManager.applyRuntime()

async function _bootstrapGame() {
  const loadedLevels = await loadGameLevels()
  const gameInstance = new CyberStreet(appElement, tuningManager, loadedLevels)
  const isDevModeEnabled = _resolveDevMode()
  if (isDevModeEnabled) {
    const devPalette = new DevPalette(tuningManager, {
      onLiveProfileChange: (profile) => {
        gameInstance.applyLiveTuning(profile)
      },
      onCycleLevelRequest: (step) => {
        return gameInstance.cycleLevel(step)
      },
      onLevelDefinitionRequest: () => {
        return gameInstance.getCurrentLevelDefinitionClone()
      },
      onSaveLevelRequest: (levelDefinition, profile) => {
        gameInstance.saveLevelAndRestart(levelDefinition, profile)
      }
    })
    gameInstance.setDevPalette(devPalette)
  }

  window.CyberStreet = gameInstance
  window.cyberloveDevTuningManager = tuningManager
}

_bootstrapGame().catch((error) => {
  console.error("Failed to bootstrap game", error)
})
