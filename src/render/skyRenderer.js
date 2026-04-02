/**
 * Sky renderer module with time-of-day gradient and dynamic stars.
 *
 * Usage:
 * const skyRenderer = new SkyRenderer(scene, camera)
 * skyRenderer.applyRuntimeTuning()
 * skyRenderer.update()
 */
import * as THREE from "three"
import { getRuntimeTuningNumber } from "../config/tuningRuntime.js"

export class SkyRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(scene, camera) {
    this.scene = scene
    this.camera = camera
    this.canvasSize = 1024
    this.canvas = document.createElement("canvas")
    this.canvas.width = this.canvasSize
    this.canvas.height = this.canvasSize
    this.context = this.canvas.getContext("2d")
    this.backgroundTexture = new THREE.CanvasTexture(this.canvas)
    this.backgroundTexture.colorSpace = THREE.SRGBColorSpace
    this.backgroundTexture.needsUpdate = true
    this.scene.background = this.backgroundTexture
    this.starField = null
    this.starFieldBright = null
    this.lastAppliedTimeOfDay = -1
    this.baseDimStarOpacity = 0.58
    this.baseBrightStarOpacity = 0.82
    this.currentProfile = {
      daylightFactor: 0,
      twilightFactor: 0,
      starVisibility: 1
    }

    this._createStarField()
    this.applyRuntimeTuning()
  }

  /**
   * Sync starfield transform each frame.
   * @returns {void}
   */
  update() {
    this._syncStarFieldToCamera()
  }

  /**
   * Apply runtime sky settings from tuning.
   * @returns {void}
   */
  applyRuntimeTuning() {
    const timeOfDay = THREE.MathUtils.clamp(getRuntimeTuningNumber("sky.timeOfDay", 2), 0, 24)
    if (Math.abs(timeOfDay - this.lastAppliedTimeOfDay) < 0.001) {
      return this.currentProfile
    }

    this.lastAppliedTimeOfDay = timeOfDay
    const palette = this._computeSkyPalette(timeOfDay)
    this._drawSkyTexture(palette)
    this._updateStarVisibility(timeOfDay)
    this.currentProfile = palette.profile
    return this.currentProfile
  }

  /**
   * Dispose all sky resources.
   * @returns {void}
   */
  dispose() {
    if (this.starField) {
      this.scene.remove(this.starField)
      this.starField.geometry.dispose()
      this.starField.material.dispose()
      this.starField = null
    }

    if (this.starFieldBright) {
      this.scene.remove(this.starFieldBright)
      this.starFieldBright.geometry.dispose()
      this.starFieldBright.material.dispose()
      this.starFieldBright = null
    }

    this.backgroundTexture.dispose()
  }

  /**
   * Draw gradient sky texture from palette values.
   * @param {object} palette
   * @returns {void}
   * @private
   * @ignore
   */
  _drawSkyTexture(palette) {
    const size = this.canvasSize
    const context = this.context
    const gradient = context.createLinearGradient(0, 0, 0, size)
    gradient.addColorStop(0, `#${palette.topColor.getHexString()}`)
    gradient.addColorStop(0.45, `#${palette.midColor.getHexString()}`)
    gradient.addColorStop(1, `#${palette.bottomColor.getHexString()}`)
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)

    const hazeGradient = context.createLinearGradient(0, size * 0.34, 0, size * 0.9)
    hazeGradient.addColorStop(0, `rgba(${palette.hazeRgb.r},${palette.hazeRgb.g},${palette.hazeRgb.b},0)`)
    hazeGradient.addColorStop(0.5, `rgba(${palette.hazeRgb.r},${palette.hazeRgb.g},${palette.hazeRgb.b},${palette.hazeMidAlpha})`)
    hazeGradient.addColorStop(1, `rgba(${palette.hazeRgb.r},${palette.hazeRgb.g},${palette.hazeRgb.b},${palette.hazeBottomAlpha})`)
    context.fillStyle = hazeGradient
    context.fillRect(0, size * 0.34, size, size * 0.66)

    for (let cloudIndex = 0; cloudIndex < 34; cloudIndex += 1) {
      const cloudX = Math.random() * size
      const cloudY = size * (0.2 + Math.random() * 0.7)
      const cloudRadiusX = size * (0.11 + Math.random() * 0.24)
      const cloudRadiusY = cloudRadiusX * (0.42 + Math.random() * 0.45)
      const alpha = palette.cloudAlphaMin + Math.random() * (palette.cloudAlphaMax - palette.cloudAlphaMin)
      const cloudRadius = Math.max(cloudRadiusX, cloudRadiusY)
      const cloudGradient = context.createRadialGradient(cloudX, cloudY, cloudRadius * 0.08, cloudX, cloudY, cloudRadius)
      cloudGradient.addColorStop(0, `rgba(${palette.cloudRgb.r},${palette.cloudRgb.g},${palette.cloudRgb.b},${alpha})`)
      cloudGradient.addColorStop(0.65, `rgba(${palette.cloudRgb.r},${palette.cloudRgb.g},${palette.cloudRgb.b},${alpha * 0.45})`)
      cloudGradient.addColorStop(1, `rgba(${palette.cloudFadeRgb.r},${palette.cloudFadeRgb.g},${palette.cloudFadeRgb.b},0)`)
      context.fillStyle = cloudGradient
      context.beginPath()
      context.ellipse(cloudX, cloudY, cloudRadiusX, cloudRadiusY, 0, 0, Math.PI * 2)
      context.fill()
    }

    const vignette = context.createRadialGradient(size * 0.5, size * 0.58, size * 0.1, size * 0.5, size * 0.58, size * 0.7)
    vignette.addColorStop(0, "rgba(0,0,0,0)")
    vignette.addColorStop(1, `rgba(${palette.vignetteRgb.r},${palette.vignetteRgb.g},${palette.vignetteRgb.b},${palette.vignetteAlpha})`)
    context.fillStyle = vignette
    context.fillRect(0, 0, size, size)

    this.backgroundTexture.needsUpdate = true
  }

  /**
   * Compute realistic palette transitions from time-of-day.
   * @param {number} timeOfDay
   * @returns {object}
   * @private
   * @ignore
   */
  _computeSkyPalette(timeOfDay) {
    const keyframes = [
      { hour: 0, top: 0x08122b, mid: 0x1a2f5a, bottom: 0x325e8a, fog: 0x1f3d60 },
      { hour: 5, top: 0x2a2850, mid: 0x5a4a79, bottom: 0x8b5f66, fog: 0x5e5576 },
      { hour: 7, top: 0x4a4a73, mid: 0x8d6e7d, bottom: 0xc08e74, fog: 0x7f6d7c },
      { hour: 10, top: 0x5d93ca, mid: 0x7fb1de, bottom: 0xa8cfec, fog: 0x7da8cc },
      { hour: 14, top: 0x67a0d8, mid: 0x8dbde7, bottom: 0xb6daf1, fog: 0x89b4d6 },
      { hour: 17, top: 0x5c8dc0, mid: 0x7ea7cf, bottom: 0xa0bfd8, fog: 0x7699bb },
      { hour: 19, top: 0x5f4f79, mid: 0x9a6a66, bottom: 0xc2866b, fog: 0x886b73 },
      { hour: 20, top: 0x2a2e4d, mid: 0x4d4f77, bottom: 0x6982a6, fog: 0x4f648a },
      { hour: 24, top: 0x08122b, mid: 0x1a2f5a, bottom: 0x325e8a, fog: 0x1f3d60 }
    ]

    const nextIndex = keyframes.findIndex((keyframe) => keyframe.hour >= timeOfDay)
    const rightKeyframe = nextIndex <= 0 ? keyframes[1] : keyframes[nextIndex]
    const leftKeyframe = nextIndex <= 0 ? keyframes[0] : keyframes[nextIndex - 1]
    const span = Math.max(0.0001, rightKeyframe.hour - leftKeyframe.hour)
    const alpha = (timeOfDay - leftKeyframe.hour) / span
    const topColor = this._lerpColor(leftKeyframe.top, rightKeyframe.top, alpha)
    const midColor = this._lerpColor(leftKeyframe.mid, rightKeyframe.mid, alpha)
    const bottomColor = this._lerpColor(leftKeyframe.bottom, rightKeyframe.bottom, alpha)
    const fogColor = this._lerpColor(leftKeyframe.fog, rightKeyframe.fog, alpha)
    const starVisibility = this._computeStarVisibility(timeOfDay)
    const dayBlend = 1 - starVisibility
    const twilightFactor = Math.max(0, 1 - Math.abs(12 - timeOfDay) / 7.5)

    return {
      topColor,
      midColor,
      bottomColor,
      fogColor,
      hazeRgb: this._colorToRgb(this._lerpColor(0x8ec2ef, 0xd5b088, dayBlend * 0.55)),
      hazeMidAlpha: 0.11 + dayBlend * 0.08,
      hazeBottomAlpha: 0.17 + dayBlend * 0.1,
      cloudRgb: this._colorToRgb(this._lerpColor(0xc8e1ff, 0xf5d0a2, dayBlend * 0.45)),
      cloudFadeRgb: this._colorToRgb(this._lerpColor(0x5078aa, 0xb26b58, dayBlend * 0.4)),
      cloudAlphaMin: 0.07 + dayBlend * 0.04,
      cloudAlphaMax: 0.14 + dayBlend * 0.04,
      vignetteRgb: this._colorToRgb(this._lerpColor(0x050a14, 0x5a3d33, dayBlend * 0.35)),
      vignetteAlpha: 0.16 + starVisibility * 0.08,
      profile: {
        daylightFactor: dayBlend,
        twilightFactor,
        starVisibility
      }
    }
  }

  /**
   * Create world-space starfield points.
   * @returns {void}
   * @private
   * @ignore
   */
  _createStarField() {
    const dimStarCount = 950
    const brightStarCount = 160
    this.starField = this._buildStarPoints(dimStarCount, 1100, 0xaed8ff, 1.4, this.baseDimStarOpacity)
    this.starFieldBright = this._buildStarPoints(brightStarCount, 1100, 0xf3fbff, 2.2, this.baseBrightStarOpacity)
    this.scene.add(this.starField)
    this.scene.add(this.starFieldBright)
    this._syncStarFieldToCamera()
  }

  /**
   * Update star opacity from day/night cycle.
   * @param {number} timeOfDay
   * @returns {void}
   * @private
   * @ignore
   */
  _updateStarVisibility(timeOfDay) {
    const visibility = this._computeStarVisibility(timeOfDay)
    this.starField.material.opacity = this.baseDimStarOpacity * visibility
    this.starFieldBright.material.opacity = this.baseBrightStarOpacity * visibility
    this.starField.visible = visibility > 0.01
    this.starFieldBright.visible = visibility > 0.01
  }

  /**
   * Compute star visibility based on hour.
   * @param {number} timeOfDay
   * @returns {number}
   * @private
   * @ignore
   */
  _computeStarVisibility(timeOfDay) {
    const hour = ((timeOfDay % 24) + 24) % 24
    if (hour >= 7 && hour <= 18) {
      return 0
    }
    if (hour < 5 || hour > 20) {
      return 1
    }
    if (hour >= 5 && hour < 7) {
      return 1 - (hour - 5) / 2
    }
    return (hour - 18) / 2
  }

  /**
   * Build one star points object on a sphere shell.
   * @param {number} count
   * @param {number} radius
   * @param {number} color
   * @param {number} size
   * @param {number} opacity
   * @returns {THREE.Points}
   * @private
   * @ignore
   */
  _buildStarPoints(count, radius, color, size, opacity) {
    const positions = new Float32Array(count * 3)

    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const jitter = radius * (0.9 + Math.random() * 0.2)
      const x = jitter * Math.sin(phi) * Math.cos(theta)
      const y = jitter * Math.cos(phi)
      const z = jitter * Math.sin(phi) * Math.sin(theta)
      const offset = index * 3
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = z
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false
    })

    return new THREE.Points(geometry, material)
  }

  /**
   * Keep starfield centered on camera to avoid translation parallax.
   * @returns {void}
   * @private
   * @ignore
   */
  _syncStarFieldToCamera() {
    if (!this.starField || !this.starFieldBright) {
      return
    }

    this.starField.position.copy(this.camera.position)
    this.starFieldBright.position.copy(this.camera.position)
  }

  /**
   * Interpolate two hex colors.
   * @param {number} leftColor
   * @param {number} rightColor
   * @param {number} alpha
   * @returns {THREE.Color}
   * @private
   * @ignore
   */
  _lerpColor(leftColor, rightColor, alpha) {
    const color = new THREE.Color(leftColor)
    const right = new THREE.Color(rightColor)
    color.lerp(right, THREE.MathUtils.clamp(alpha, 0, 1))
    return color
  }

  /**
   * Convert THREE color to RGB object.
   * @param {THREE.Color} color
   * @returns {{r: number, g: number, b: number}}
   * @private
   * @ignore
   */
  _colorToRgb(color) {
    return {
      r: Math.round(color.r * 255),
      g: Math.round(color.g * 255),
      b: Math.round(color.b * 255)
    }
  }
}
