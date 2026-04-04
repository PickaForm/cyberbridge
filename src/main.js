/**
 * Cyberlove POC entrypoint.
 *
 * Usage:
 * npm install
 * npm run dev
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

const DEV_MODE_STORAGE_KEY = "cyberlove-dev-mode-v1"
const GAME_LEVELS = [
  {
    id: 1,
    moveSpeed: 20,
    targetDistance: 1000,
    targetChrono: 0,
    targetGirlsHit: 0,
    targetBoysHit: 0,
    targetScore: 0,
    loseOnGirlHitThreshold: 10,
    loseOnBoyHitThreshold: 0,
    objectiveText: "Pas taper les filles !",
    loseText: "T'as percuté 10 filles, boulet !",
    winText: "Bravo, t'as parcouru 1000m sans incident !",
    retryText: "Etre plus gentleman",
    nextLevelText: "Continuer"
  },
  {
    id: 2,
    moveSpeed: 40,
    targetDistance: 0,
    targetChrono: 30000,
    targetGirlsHit: 0,
    targetBoysHit: 20,
    targetScore: 0,
    loseOnGirlHitThreshold: 10,
    loseOnBoyHitThreshold: 0,
    objectiveText: "Choisissez vos cibles !",
    loseText: "Ouvre les yeux, les gars c'est les trucs en bleu !",
    winText: "Sniper attitude, bravo !",
    retryText: "Viser mieux",
    nextLevelText: "Prêts pour un peu de vitesse ?"
  },
  {
    id: 3,
    moveSpeed: 80,
    targetDistance: 4000,
    targetChrono: 0,
    targetGirlsHit: 0,
    targetBoysHit: 120,
    targetScore: 0,
    loseOnGirlHitThreshold: 0,
    loseOnBoyHitThreshold: 0,
    objectiveText: "Baffez un max de mecs !",
    loseText: "Manque d'ambition !",
    winText: "Wow, t'es une vraie machine à baffes, respect !",
    retryText: "Baffer mieux",
    nextLevelText: "Je sais, donc laisse moi passer au level suivant, sinon..."
  },
  {
    id: 4,
    moveSpeed: 120,
    targetDistance: 10000,
    targetChrono: 0,
    targetGirlsHit: 0,
    targetBoysHit: 0,
    targetScore: 100,
    loseOnGirlHitThreshold: 0,
    loseOnBoyHitThreshold: 0,
    objectiveText: "Visez surtout des mecs. Question de ratio...",
    loseText: "Hmmm, pas assez de réflexes. Recalé !",
    winText: "OMG, t'as des réflexes de mouche !",
    retryText: "OK, compris, je vais Use the Force.",
    nextLevelText: "Y'a pas de next level, j'ai du boulot. Relancer le jeu ?"
  }
]

/**
 * Game orchestrator.
 */
class CyberStreet {
  /**
   * @param {HTMLElement} appElement
   * @param {DevTuningManager} tuningManager
   */
  constructor(appElement, tuningManager) {
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
    this.lastLiveProfile = tuningManager.getProfileClone()
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
   * Start a level directly from its configured id.
   * @param {number} levelId
   * @returns {void}
   */
  testLevelById(levelId) {
    const normalizedLevelId = Math.max(1, Math.round(Number(levelId) || 1))
    const foundLevelIndex = GAME_LEVELS.findIndex((levelDefinition) => levelDefinition.id === normalizedLevelId)
    this.currentLevelIndex = foundLevelIndex >= 0 ? foundLevelIndex : 0
    this._startCurrentLevel()
  }

  /**
   * Bind overlay input events used by level intro and results.
   * @returns {void}
   * @private
   * @ignore
   */
  _bindLevelOverlayEvents() {
    this._onOverlayKeyDown = this._onOverlayKeyDown.bind(this)
    this._onOverlayActionClick = this._onOverlayActionClick.bind(this)
    window.addEventListener("keydown", this._onOverlayKeyDown)
    this.levelOverlayActionElement?.addEventListener("click", this._onOverlayActionClick)
  }

  /**
   * Start the currently selected level from intro state.
   * @returns {void}
   * @private
   * @ignore
   */
  _startCurrentLevel() {
    const levelDefinition = this._getCurrentLevelDefinition()
    gameConfig.player.moveSpeed = levelDefinition.moveSpeed
    this._resetPlayerAndSystemsForLevel()
    this._resetRunStats()
    this._showLevelIntro(levelDefinition)
  }

  /**
   * Return the active level definition.
   * @returns {object}
   * @private
   * @ignore
   */
  _getCurrentLevelDefinition() {
    return GAME_LEVELS[this.currentLevelIndex] ?? GAME_LEVELS[GAME_LEVELS.length - 1]
  }

  /**
   * Reset score and counters for a fresh level attempt.
   * @returns {void}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _buildLevelObjectiveText(levelDefinition) {
    const objectiveLines = []
    const targetBoysHit = this._getActiveLevelThreshold(levelDefinition.targetBoysHit)
    const targetGirlsHit = this._getActiveLevelThreshold(levelDefinition.targetGirlsHit)
    const targetScore = this._getActiveLevelThreshold(levelDefinition.targetScore)
    const targetDistance = this._getActiveLevelThreshold(levelDefinition.targetDistance)
    const targetChrono = this._getActiveLevelThreshold(levelDefinition.targetChrono)

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

    const baseText = String(levelDefinition.objectiveText ?? "").trim()
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _formatIntegerWithSpacing(value) {
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  }

  /**
   * Format milliseconds to seconds string for objective text.
   * @param {number} milliseconds
   * @returns {string}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
      actionLabel: isWin ? levelDefinition.nextLevelText : levelDefinition.retryText
    })
    this._renderChronoHud()
  }

  /**
   * Advance to next level or loop to first one after final win.
   * @returns {void}
   * @private
   * @ignore
   */
  _continueAfterWin() {
    const nextLevelIndex = this.currentLevelIndex + 1
    if (nextLevelIndex >= GAME_LEVELS.length) {
      this.currentLevelIndex = 0
    } else {
      this.currentLevelIndex = nextLevelIndex
    }
    this._startCurrentLevel()
  }

  /**
   * Handle keyboard input for intro overlay.
   * @returns {void}
   * @private
   * @ignore
   */
  _onOverlayKeyDown() {
    this._startGameplay()
  }

  /**
   * Handle overlay action button click for win/lose states.
   * @returns {void}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
    this.tuningManager.applyProfileLive(profile)
    const skyProfile = this.rendererApp.applyRuntimeTuning()
    this.player.applyRuntimeTuning()
    this.audioSystem.setVolumesFromPercent(gameConfig.sound.musicVolume, gameConfig.sound.hitVolume)
    this._renderScore()
    this._renderDistance(this.player.mesh.position)

    const shouldRecreateProceduralCity = this._hasLiveSectionChanged(profile, "buildings") ||
      this._hasLiveSectionChanged(profile, "stands") ||
      this._hasLiveSectionChanged(profile, "clouds")
    const shouldRecreateCrowd = this._hasLiveSectionChanged(profile, "crowd")
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

    this.lastLiveProfile = JSON.parse(JSON.stringify(profile))
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
    const loseOnGirlHitThreshold = Math.max(0, Number(levelDefinition.loseOnGirlHitThreshold) || 0)
    const loseOnBoyHitThreshold = Math.max(0, Number(levelDefinition.loseOnBoyHitThreshold) || 0)
    if (isGirlHit && loseOnGirlHitThreshold > 0 && this.girlHits >= loseOnGirlHitThreshold) {
      this._finishLevel(false, levelDefinition.loseText)
      return
    }

    if (!isGirlHit && loseOnBoyHitThreshold > 0 && this.boyHits >= loseOnBoyHitThreshold) {
      this._finishLevel(false, levelDefinition.loseText)
    }
  }

  /**
   * Check whether player is currently moving backward.
   * @returns {boolean}
   * @private
   * @ignore
   */
  _isPlayerMovingBackward() {
    const forwardVelocity = Number(this.player?.velocity?.forward ?? 0)
    return forwardVelocity < -0.05
  }

  /**
   * Render score value into HUD if score element exists.
   * @returns {void}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _renderChronoHud() {
    if (!this.chronoHudElement || !this.chronoValueElement) {
      return
    }

    const levelDefinition = this._getCurrentLevelDefinition()
    const targetChrono = this._getActiveLevelThreshold(levelDefinition.targetChrono)
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _computeDisplayDistance(playerPosition) {
    const distanceFromStart = this._computeDistanceFromStart(playerPosition)
    const distanceCoef = Math.max(0, gameConfig.player.distanceCoef)
    return distanceFromStart * distanceCoef
  }

  /**
   * Recreate only flying cars simulation and rendering.
   * @returns {void}
   * @private
   * @ignore
   */
  _recreateFlyingCarsSystem() {
    this.flyingCars.dispose()
    this.flyingCars = new FlyingCarsSystem(this.rendererApp.scene)
    this.flyingCars.update(0, this.player.mesh.position)
  }

  /**
   * Bind interaction handlers to class scope.
   * @returns {void}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _onPointerCancel() {
    this.pointerInteractionState.active = false
    this.pointerInteractionState.pointerId = null
  }

  /**
   * Fallback click interaction for desktop when pointer sequence is not delivered.
   * @param {MouseEvent} event
   * @returns {void}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _hasLiveSectionChanged(nextProfile, sectionKey) {
    const previousSection = this.lastLiveProfile?.[sectionKey] ?? {}
    const nextSection = nextProfile?.[sectionKey] ?? {}
    return JSON.stringify(previousSection) !== JSON.stringify(nextSection)
  }

  /**
   * Main animation loop.
   * @returns {void}
   * @private
   * @ignore
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
   * Evaluate active triggers and resolve win/lose with combined victory goals.
   * @returns {void}
   * @private
   * @ignore
   */
  _evaluateLevelCompletion() {
    if (this.gameState !== "playing") {
      return
    }

    const levelDefinition = this._getCurrentLevelDefinition()
    const targetDistance = this._getActiveLevelThreshold(levelDefinition.targetDistance)
    const targetChrono = this._getActiveLevelThreshold(levelDefinition.targetChrono)
    const targetGirlsHit = this._getActiveLevelThreshold(levelDefinition.targetGirlsHit)
    const targetBoysHit = this._getActiveLevelThreshold(levelDefinition.targetBoysHit)
    const targetScore = this._getActiveLevelThreshold(levelDefinition.targetScore)
    const isDistanceTriggerActive = targetDistance > 0
    const isChronoTriggerActive = targetChrono > 0
    const isDistanceReached = isDistanceTriggerActive && this.distanceMeters >= targetDistance
    const isChronoExpired = isChronoTriggerActive && this.levelElapsedMs >= targetChrono

    if (!isDistanceReached && !isChronoExpired) {
      return
    }

    if (isChronoExpired && isDistanceTriggerActive && !isDistanceReached) {
      this._finishLevel(false, levelDefinition.loseText)
      return
    }

    const isGirlsTargetReached = targetGirlsHit <= 0 || this.girlHits >= targetGirlsHit
    const isBoysTargetReached = targetBoysHit <= 0 || this.boyHits >= targetBoysHit
    const isScoreTargetReached = targetScore <= 0 || this.score >= targetScore
    const isVictory = isGirlsTargetReached && isBoysTargetReached && isScoreTargetReached
    if (isVictory) {
      this._finishLevel(true, levelDefinition.winText)
      return
    }

    this._finishLevel(false, levelDefinition.loseText)
  }
}

/**
 * Resolve persisted dev mode from URL query and local storage.
 *
 * Usage:
 * const isDevModeEnabled = _resolveDevMode()
 * // URL ?dev=true|false has priority and persists to localStorage
 * @returns {boolean}
 * @private
 * @ignore
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
 * @private
 * @ignore
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
 * @private
 * @ignore
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
 * @private
 * @ignore
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
 * @private
 * @ignore
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

const gameInstance = new CyberStreet(appElement, tuningManager)
const isDevModeEnabled = _resolveDevMode()
if (isDevModeEnabled) {
  const devPalette = new DevPalette(tuningManager, (profile) => {
    gameInstance.applyLiveTuning(profile)
  }, (levelId) => {
    gameInstance.testLevelById(levelId)
  })
  gameInstance.setDevPalette(devPalette)
}

window.CyberStreet = gameInstance
window.cyberloveDevTuningManager = tuningManager
