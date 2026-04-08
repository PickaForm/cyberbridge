/**
 * Third-person orbit camera around player.
 *
 * Usage:
 * const cameraRig = new CameraRig(camera, canvas, player.mesh)
 * cameraRig.update(delta)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} inputElement
   * @param {THREE.Object3D} target
   */
  constructor(camera, inputElement, target) {
    this.camera = camera
    this.inputElement = inputElement
    this.target = target

    this.state = {
      yaw: gameConfig.camera.yaw,
      pitch: gameConfig.camera.pitch,
      distance: gameConfig.camera.defaultDistance
    }
    this.orbitTouchPointerId = null
    this.isRightDragging = false
    this.lastPointer = { x: 0, y: 0 }
    this.pinchDistance = 0

    this._bindHandlers()
    this._bindEvents()
  }

  /**
   * Update camera transform.
   * @param {number} deltaTime
   * @returns {void}
   */
  update(deltaTime) {
    const targetPosition = new THREE.Vector3()
    this.target.getWorldPosition(targetPosition)
    targetPosition.y += gameConfig.camera.targetHeightOffset

    const offset = new THREE.Vector3()
    offset.setFromSphericalCoords(this.state.distance, this.state.pitch, this.state.yaw)
    const desiredPosition = targetPosition.clone().add(offset)

    const cameraElasticity = Math.max(0.1, Number(gameConfig.player.cameraElasticity) || 8)
    this.camera.position.lerp(desiredPosition, Math.min(1, deltaTime * cameraElasticity))
    this.camera.lookAt(targetPosition)
  }

  /**
   * Release listeners.
   * @returns {void}
   */
  dispose() {
    this.inputElement.removeEventListener("contextmenu", this._onContextMenu)
    this.inputElement.removeEventListener("mousedown", this._onMouseDown)
    window.removeEventListener("mousemove", this._onMouseMove)
    window.removeEventListener("mouseup", this._onMouseUp)
    this.inputElement.removeEventListener("wheel", this._onWheel)
    this.inputElement.removeEventListener("touchstart", this._onTouchStart)
    this.inputElement.removeEventListener("touchmove", this._onTouchMove)
    this.inputElement.removeEventListener("touchend", this._onTouchEnd)
    this.inputElement.removeEventListener("touchcancel", this._onTouchEnd)
  }

  /**
   * Bind methods to class scope.
   * @returns {void}
   */
  _bindHandlers() {
    this._onContextMenu = this._onContextMenu.bind(this)
    this._onMouseDown = this._onMouseDown.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseUp = this._onMouseUp.bind(this)
    this._onWheel = this._onWheel.bind(this)
    this._onTouchStart = this._onTouchStart.bind(this)
    this._onTouchMove = this._onTouchMove.bind(this)
    this._onTouchEnd = this._onTouchEnd.bind(this)
  }

  /**
   * Register pointer events.
   * @returns {void}
   */
  _bindEvents() {
    this.inputElement.addEventListener("contextmenu", this._onContextMenu)
    this.inputElement.addEventListener("mousedown", this._onMouseDown)
    window.addEventListener("mousemove", this._onMouseMove)
    window.addEventListener("mouseup", this._onMouseUp)
    this.inputElement.addEventListener("wheel", this._onWheel, { passive: false })
    this.inputElement.addEventListener("touchstart", this._onTouchStart, { passive: false })
    this.inputElement.addEventListener("touchmove", this._onTouchMove, { passive: false })
    this.inputElement.addEventListener("touchend", this._onTouchEnd, { passive: false })
    this.inputElement.addEventListener("touchcancel", this._onTouchEnd, { passive: false })
  }

  /**
   * Prevent default context menu on right click.
   * @param {MouseEvent} event
   * @returns {void}
   */
  _onContextMenu(event) {
    event.preventDefault()
  }

  /**
   * Start orbit drag.
   * @param {MouseEvent} event
   * @returns {void}
   */
  _onMouseDown(event) {
    if (event.button !== 0) {
      return
    }
    this.isRightDragging = true
    this.lastPointer.x = event.clientX
    this.lastPointer.y = event.clientY
  }

  /**
   * Update orbit drag.
   * @param {MouseEvent} event
   * @returns {void}
   */
  _onMouseMove(event) {
    if (!this.isRightDragging) {
      return
    }
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer.x = event.clientX
    this.lastPointer.y = event.clientY
    this._applyOrbitDelta(dx, dy)
  }

  /**
   * Stop orbit drag.
   * @returns {void}
   */
  _onMouseUp() {
    this.isRightDragging = false
  }

  /**
   * Zoom camera with mouse wheel.
   * @param {WheelEvent} event
   * @returns {void}
   */
  _onWheel(event) {
    event.preventDefault()
    this.state.distance = THREE.MathUtils.clamp(
      this.state.distance + event.deltaY * 0.008,
      gameConfig.camera.minDistance,
      gameConfig.camera.maxDistance
    )
  }

  /**
   * Capture right-side touch for camera orbit.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchStart(event) {
    if (event.touches.length === 2) {
      this.pinchDistance = this._distance2D(event.touches[0], event.touches[1])
      event.preventDefault()
      return
    }

    const halfWidth = window.innerWidth * 0.5
    for (const touch of event.changedTouches) {
      if (touch.clientX <= halfWidth) {
        continue
      }
      if (this.orbitTouchPointerId !== null) {
        continue
      }
      this.orbitTouchPointerId = touch.identifier
      this.lastPointer.x = touch.clientX
      this.lastPointer.y = touch.clientY
      event.preventDefault()
      break
    }
  }

  /**
   * Handle touch orbit and pinch zoom.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchMove(event) {
    if (event.touches.length === 2) {
      const currentPinch = this._distance2D(event.touches[0], event.touches[1])
      const pinchDelta = currentPinch - this.pinchDistance
      this.pinchDistance = currentPinch
      this.state.distance = THREE.MathUtils.clamp(
        this.state.distance - pinchDelta * 0.01,
        gameConfig.camera.minDistance,
        gameConfig.camera.maxDistance
      )
      event.preventDefault()
      return
    }

    if (this.orbitTouchPointerId === null) {
      return
    }

    for (const touch of event.changedTouches) {
      if (touch.identifier !== this.orbitTouchPointerId) {
        continue
      }
      const dx = touch.clientX - this.lastPointer.x
      const dy = touch.clientY - this.lastPointer.y
      this.lastPointer.x = touch.clientX
      this.lastPointer.y = touch.clientY
      this._applyOrbitDelta(dx, dy)
      event.preventDefault()
      break
    }
  }

  /**
   * Release active touch pointer.
   * @param {TouchEvent} event
   * @returns {void}
   */
  _onTouchEnd(event) {
    for (const touch of event.changedTouches) {
      if (touch.identifier === this.orbitTouchPointerId) {
        this.orbitTouchPointerId = null
      }
    }
  }

  /**
   * Apply yaw and pitch deltas.
   * @param {number} dx
   * @param {number} dy
   * @returns {void}
   */
  _applyOrbitDelta(dx, dy) {
    this.state.yaw -= dx * 0.0055
    this.state.pitch = THREE.MathUtils.clamp(this.state.pitch - dy * 0.004, 0.15, 1.52)
  }

  /**
   * 2D distance helper for pinch.
   * @param {Touch} touchA
   * @param {Touch} touchB
   * @returns {number}
   */
  _distance2D(touchA, touchB) {
    const dx = touchA.clientX - touchB.clientX
    const dy = touchA.clientY - touchB.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }
}
