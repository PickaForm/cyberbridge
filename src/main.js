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

/**
 * Game orchestrator.
 */
class CyberlovePoc {
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
    this.proceduralCity = new ProceduralCity(this.rendererApp.scene)
    this.audioSystem = new AudioSystem()
    this.audioSystem.setVolumesFromPercent(gameConfig.sound.musicVolume, gameConfig.sound.hitVolume)
    this.crowd = new CrowdSystem(this.rendererApp.scene, {
      onNpcHit: () => {
        this.audioSystem.playHitSound()
      }
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
    this.proceduralCity.applyDayNightProfile(this.rendererApp.getSkyProfile())
    this.lastLiveProfile = tuningManager.getProfileClone()
    this.lastFrameTime = performance.now()
    this.isRunning = true

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
   * Apply tuning profile live and refresh dynamic systems.
   * @param {object} profile
   * @returns {void}
   */
  applyLiveTuning(profile) {
    this.tuningManager.applyProfileLive(profile)
    const skyProfile = this.rendererApp.applyRuntimeTuning()
    this.player.applyRuntimeTuning()
    this.audioSystem.setVolumesFromPercent(gameConfig.sound.musicVolume, gameConfig.sound.hitVolume)

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
      onNpcHit: () => {
        this.audioSystem.playHitSound()
      }
    })
    this.crowd.update(0, this.player.mesh.position, this.player.forwardVector.z)
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

    this.player.update(deltaTime)
    this.proceduralCity.update(this.player.mesh.position.z)
    this.crowd.update(deltaTime, this.player.mesh.position, this.player.forwardVector.z)
    this.flyingCars.update(deltaTime, this.player.mesh.position)
    this.cameraRig.update(deltaTime)
    this.rendererApp.render()

    requestAnimationFrame(this._loop)
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
await tuningManager.hydrateFromSharedProfile()
tuningManager.applyRuntime()

const gameInstance = new CyberlovePoc(appElement, tuningManager)
const isDevModeEnabled = _resolveDevMode()
if (isDevModeEnabled) {
  const devPalette = new DevPalette(tuningManager, (profile) => {
    gameInstance.applyLiveTuning(profile)
  })
  gameInstance.setDevPalette(devPalette)
}

window.cyberlovePoc = gameInstance
window.cyberloveDevTuningManager = tuningManager
