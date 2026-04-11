/**
 * Player cube movement constrained to the bridge.
 *
 * Usage:
 * const player = new PlayerController(scene, canvas)
 * player.update(delta)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"
import { PlayerRenderer } from "./playerRenderer.js"

export class PlayerController {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} inputElement
   * @param {THREE.PerspectiveCamera | null} camera
   */
  constructor(scene, inputElement, camera = null) {
    this.inputElement = inputElement
    this.camera = camera
    this.playerRenderer = new PlayerRenderer(scene)
    this.mesh = this.playerRenderer.getMesh()
    this.baseY = 1.08
    this.position = { x: 0, y: this.baseY, z: 0 }
    this.verticalVelocity = 0
    this.isJumpRequested = false
    this.forwardVector = new THREE.Vector3(0, 0, 1)
    this.rightVector = new THREE.Vector3(1, 0, 0)
    this.upVector = new THREE.Vector3(0, 1, 0)

    this.inputState = {
      forward: 0,
      strafe: 0
    }
    this.velocity = {
      forward: 0,
      strafe: 0
    }
    this.keys = new Map()
    this.touchMovePointerId = null
    this.touchMoveStart = { x: 0, y: 0 }
    this.touchMoveCurrent = { x: 0, y: 0 }

    this._bindHandlers()
    this._bindEvents()
  }

  /**
   * Update player transform.
   * @param {number} deltaTime
   * @returns {void}
   */
  update(deltaTime) {
    this._updateInputState()
    this._tryStartJump()

    const targetForward = this.inputState.forward
    const targetStrafe = this.inputState.strafe
    this.velocity.forward = THREE.MathUtils.lerp(this.velocity.forward, targetForward, Math.min(1, deltaTime * 8))
    this.velocity.strafe = THREE.MathUtils.lerp(this.velocity.strafe, targetStrafe, Math.min(1, deltaTime * 8))

    this._updateWalkwayBasisFromCamera()

    const forwardDistance = this.velocity.forward * gameConfig.player.moveSpeed * deltaTime
    const strafeDistance = this.velocity.strafe * gameConfig.player.strafeSpeed * deltaTime
    this.position.x += this.forwardVector.x * forwardDistance + this.rightVector.x * strafeDistance
    this.position.z += this.forwardVector.z * forwardDistance + this.rightVector.z * strafeDistance

    const xLimit = gameConfig.world.walkwayWidth * 0.5 - gameConfig.player.xMargin
    this.position.x = THREE.MathUtils.clamp(this.position.x, -xLimit, xLimit)
    this._updateJumpPhysics(deltaTime)
    this.playerRenderer.setPosition(this.position.x, this.position.y, this.position.z)
  }

  /**
   * Apply runtime tuning updates to player render.
   * @returns {void}
   */
  applyRuntimeTuning() {
    this.playerRenderer.applyRuntimeTuning()
  }

  /**
   * Advance forward at a fixed world speed without consuming input.
   * @param {number} deltaTime
   * @param {number} forwardSpeed
   * @returns {void}
   */
  forceAutoForward(deltaTime, forwardSpeed) {
    this._updateWalkwayBasisFromCamera()
    this.inputState.forward = 0
    this.inputState.strafe = 0
    this.velocity.forward = 1
    this.velocity.strafe = 0
    const safeForwardSpeed = Math.max(0, Number(forwardSpeed) || 0)
    const forwardDistance = safeForwardSpeed * deltaTime
    this.position.x += this.forwardVector.x * forwardDistance
    this.position.z += this.forwardVector.z * forwardDistance

    const xLimit = gameConfig.world.walkwayWidth * 0.5 - gameConfig.player.xMargin
    this.position.x = THREE.MathUtils.clamp(this.position.x, -xLimit, xLimit)
    this._updateJumpPhysics(deltaTime)
    this.playerRenderer.setPosition(this.position.x, this.position.y, this.position.z)
  }

  /**
   * Reset player movement state and teleport to a target position.
   * @param {THREE.Vector3} nextPosition
   * @returns {void}
   */
  resetState(nextPosition) {
    this.position.x = nextPosition.x
    this.position.y = nextPosition.y
    this.position.z = nextPosition.z
    this.verticalVelocity = 0
    this.isJumpRequested = false
    this.velocity.forward = 0
    this.velocity.strafe = 0
    this.inputState.forward = 0
    this.inputState.strafe = 0
    this.keys.clear()
    this.touchMovePointerId = null
    this.touchMoveStart.x = 0
    this.touchMoveStart.y = 0
    this.touchMoveCurrent.x = 0
    this.touchMoveCurrent.y = 0
    this.playerRenderer.setPosition(this.position.x, this.position.y, this.position.z)
  }

  /**
   * Dispose input listeners.
   * @returns {void}
   */
  dispose() {
    window.removeEventListener("keydown", this._onKeyDown)
    window.removeEventListener("keyup", this._onKeyUp)
    this.inputElement.removeEventListener("touchstart", this._onTouchStart)
    this.inputElement.removeEventListener("touchmove", this._onTouchMove)
    this.inputElement.removeEventListener("touchend", this._onTouchEnd)
    this.inputElement.removeEventListener("touchcancel", this._onTouchEnd)
    this.playerRenderer.dispose()
  }

  /**
   * Cache bound event handlers.
   * @returns {void}
   */
  _bindHandlers() {
    this._onKeyDown = this._onKeyDown.bind(this)
    this._onKeyUp = this._onKeyUp.bind(this)
    this._onTouchStart = this._onTouchStart.bind(this)
    this._onTouchMove = this._onTouchMove.bind(this)
    this._onTouchEnd = this._onTouchEnd.bind(this)
  }

  /**
   * Register keyboard and touch events.
   * @returns {void}
   */
  _bindEvents() {
    window.addEventListener("keydown", this._onKeyDown)
    window.addEventListener("keyup", this._onKeyUp)
    this.inputElement.addEventListener("touchstart", this._onTouchStart, { passive: false })
    this.inputElement.addEventListener("touchmove", this._onTouchMove, { passive: false })
    this.inputElement.addEventListener("touchend", this._onTouchEnd, { passive: false })
    this.inputElement.addEventListener("touchcancel", this._onTouchEnd, { passive: false })
  }

  /**
   * Build desired movement from keyboard and touch.
   * @returns {void}
   */
  _updateInputState() {
    const keyboardForward = Number(this._isControlPressed(["ArrowUp"], ["z"])) - Number(this._isControlPressed(["ArrowDown"], ["s"]))
    const keyboardStrafe = Number(this._isControlPressed(["ArrowLeft"], ["q"])) - Number(this._isControlPressed(["ArrowRight"], ["d"]))
    let touchForward = 0
    let touchStrafe = 0

    if (this.touchMovePointerId !== null) {
      const dx = this.touchMoveCurrent.x - this.touchMoveStart.x
      const dy = this.touchMoveCurrent.y - this.touchMoveStart.y
      touchStrafe = THREE.MathUtils.clamp(-dx / 48, -1, 1)
      touchForward = THREE.MathUtils.clamp(-dy / 48, -1, 1)
    }

    this.inputState.forward = THREE.MathUtils.clamp(keyboardForward + touchForward, -1, 1)
    this.inputState.strafe = THREE.MathUtils.clamp(keyboardStrafe + touchStrafe, -1, 1)
  }

  /**
   * Check if one control is currently pressed using code or key value.
   * @param {string[]} codes
   * @param {string[]} keys
   * @returns {boolean}
   */
  _isControlPressed(codes, keys) {
    const hasCode = codes.some((code) => this.keys.get(`code:${code}`))
    const hasKey = keys.some((keyValue) => this.keys.get(`key:${keyValue}`))
    return Boolean(hasCode || hasKey)
  }

  /**
   * Handle keyboard press.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  _onKeyDown(event) {
    this.keys.set(`code:${event.code}`, true)
    this.keys.set(`key:${event.key.toLowerCase()}`, true)

    if (event.code === "Space") {
      this.isJumpRequested = true
      event.preventDefault()
    }
  }

  /**
   * Handle keyboard release.
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  _onKeyUp(event) {
    this.keys.set(`code:${event.code}`, false)
    this.keys.set(`key:${event.key.toLowerCase()}`, false)
  }

  /**
   * Start a jump from the ground using configurable target height and gravity.
   * @returns {void}
   */
  _tryStartJump() {
    if (!this.isJumpRequested) {
      return
    }

    this.isJumpRequested = false
    if (!this._isOnGround()) {
      return
    }

    const gravity = Math.max(0.01, gameConfig.player.gravity)
    const jumpHeight = Math.max(0, gameConfig.player.jumpHeight)
    this.verticalVelocity = Math.sqrt(2 * gravity * jumpHeight)
  }

  /**
   * Integrate vertical velocity with gravity and clamp back to ground.
   * @param {number} deltaTime
   * @returns {void}
   */
  _updateJumpPhysics(deltaTime) {
    const gravity = Math.max(0.01, gameConfig.player.gravity)
    this.verticalVelocity -= gravity * deltaTime
    this.position.y += this.verticalVelocity * deltaTime

    if (this.position.y <= this.baseY) {
      this.position.y = this.baseY
      this.verticalVelocity = 0
    }
  }

  /**
   * Check if player currently touches the walkway.
   * @returns {boolean}
   */
  _isOnGround() {
    return this.position.y <= this.baseY + 0.0001
  }

  /**
   * Start left-side movement touch control.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchStart(event) {
    const halfWidth = window.innerWidth * 0.5
    for (const touch of event.changedTouches) {
      if (touch.clientX > halfWidth) {
        continue
      }
      if (this.touchMovePointerId !== null) {
        continue
      }
      this.touchMovePointerId = touch.identifier
      this.touchMoveStart.x = touch.clientX
      this.touchMoveStart.y = touch.clientY
      this.touchMoveCurrent.x = touch.clientX
      this.touchMoveCurrent.y = touch.clientY
      event.preventDefault()
      break
    }
  }

  /**
   * Update movement touch stick.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchMove(event) {
    if (this.touchMovePointerId === null) {
      return
    }

    for (const touch of event.changedTouches) {
      if (touch.identifier !== this.touchMovePointerId) {
        continue
      }
      this.touchMoveCurrent.x = touch.clientX
      this.touchMoveCurrent.y = touch.clientY
      event.preventDefault()
      break
    }
  }

  /**
   * Stop movement touch control.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchEnd(event) {
    if (this.touchMovePointerId === null) {
      return
    }

    for (const touch of event.changedTouches) {
      if (touch.identifier !== this.touchMovePointerId) {
        continue
      }
      this.touchMovePointerId = null
      this.touchMoveCurrent.x = this.touchMoveStart.x
      this.touchMoveCurrent.y = this.touchMoveStart.y
      event.preventDefault()
      break
    }
  }

  /**
   * Compute movement basis from camera orientation projected on walkway plane.
   * @returns {void}
   */
  _updateWalkwayBasisFromCamera() {
    if (!this.camera) {
      this.forwardVector.set(0, 0, 1)
      this.rightVector.set(1, 0, 0)
      return
    }

    this.camera.getWorldDirection(this.forwardVector)
    this.forwardVector.y = 0

    if (this.forwardVector.lengthSq() < 0.0001) {
      this.forwardVector.set(0, 0, 1)
      this.rightVector.set(1, 0, 0)
      return
    }

    this.forwardVector.normalize()
    this.rightVector.crossVectors(this.upVector, this.forwardVector).normalize()
  }
}
