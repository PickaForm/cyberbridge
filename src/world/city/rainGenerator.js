/**
 * Rain layer generator for procedural city chunks.
 *
 * Usage:
 * const generator = new RainGenerator(resources)
 * generator.build(chunkGroup, rng)
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

export class RainGenerator {
  /**
   * @param {object} resources
   */
  constructor(resources) {
    this.resources = resources
  }

  /**
   * Build one rain layer for a chunk.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @returns {void}
   */
  build(chunkGroup, rng) {
    const rainIntensity = THREE.MathUtils.clamp(
      getRuntimeTuningNumber("rain.intensity", getRuntimeTuningNumber("world.rainIntensity", 0.35)),
      0,
      1
    )
    if (rainIntensity <= 0) {
      return
    }

    const chunkZRangeMultiplier = getRuntimeTuningNumber(
      "rain.chunkZRangeMultiplier",
      getRuntimeTuningNumber("clouds.chunkZRangeMultiplier", 0.56)
    )
    const chunkZRange = gameConfig.world.chunkLength * chunkZRangeMultiplier
    const maxDropCount = Math.max(0, Math.round(getRuntimeTuningNumber("rain.maxDropCount", 900)))
    const xSpan = Math.max(1, getRuntimeTuningNumber("rain.xSpan", 760))
    const yMin = getRuntimeTuningNumber("rain.yMin", 32)
    const yMax = Math.max(yMin + 1, getRuntimeTuningNumber("rain.yMax", 190))
    const dropWidthRange = this._resolveRange("rain.dropWidthMin", "rain.dropWidthMax", 0.65, 1.5)
    const dropStretchRange = this._resolveRange("rain.dropStretchMin", "rain.dropStretchMax", 2.8, 9.6)
    const tiltXRange = this._resolveRange("rain.tiltXMin", "rain.tiltXMax", -0.3, -0.1)
    const tiltZRange = this._resolveRange("rain.tiltZMin", "rain.tiltZMax", -0.15, 0.15)
    const fallSpeedRange = this._resolveRange("rain.fallSpeedMin", "rain.fallSpeedMax", 26, 68)
    const driftSpeedRange = this._resolveRange("rain.driftSpeedMin", "rain.driftSpeedMax", 0.45, 1.55)
    const driftAmplitudeRange = this._resolveRange("rain.driftAmplitudeMin", "rain.driftAmplitudeMax", 6, 17)
    const wrapPadding = Math.max(0, getRuntimeTuningNumber("rain.wrapPadding", 36))
    const rainDropCount = Math.max(0, Math.round(maxDropCount * rainIntensity))

    if (rainDropCount <= 0) {
      return
    }

    this._addRainLayer(chunkGroup, rng, {
      count: rainDropCount,
      xMin: -xSpan,
      xMax: xSpan,
      yMin,
      yMax,
      zMin: -chunkZRange,
      zMax: chunkZRange,
      dropWidthMin: dropWidthRange.min,
      dropWidthMax: dropWidthRange.max,
      dropStretchMin: dropStretchRange.min,
      dropStretchMax: dropStretchRange.max,
      tiltXMin: tiltXRange.min,
      tiltXMax: tiltXRange.max,
      tiltZMin: tiltZRange.min,
      tiltZMax: tiltZRange.max,
      fallSpeedMin: fallSpeedRange.min,
      fallSpeedMax: fallSpeedRange.max,
      driftSpeedMin: driftSpeedRange.min,
      driftSpeedMax: driftSpeedRange.max,
      driftAmplitudeMin: driftAmplitudeRange.min,
      driftAmplitudeMax: driftAmplitudeRange.max,
      wrapPadding
    })
  }

  /**
   * Add one instanced rain layer.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {{count: number, xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number, dropWidthMin: number, dropWidthMax: number, dropStretchMin: number, dropStretchMax: number, tiltXMin: number, tiltXMax: number, tiltZMin: number, tiltZMax: number, fallSpeedMin: number, fallSpeedMax: number, driftSpeedMin: number, driftSpeedMax: number, driftAmplitudeMin: number, driftAmplitudeMax: number, wrapPadding: number}} options
   * @returns {void}
   */
  _addRainLayer(chunkGroup, rng, options) {
    const rainMesh = new THREE.InstancedMesh(this.resources.geometries.rainDrop, this.resources.materials.rainDrop, options.count)
    rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    rainMesh.frustumCulled = false

    const dummy = new THREE.Object3D()

    for (let dropIndex = 0; dropIndex < options.count; dropIndex += 1) {
      const x = options.xMin + rng() * (options.xMax - options.xMin)
      const y = options.yMin + rng() * (options.yMax - options.yMin)
      const z = options.zMin + rng() * (options.zMax - options.zMin)
      const stretch = options.dropStretchMin + rng() * (options.dropStretchMax - options.dropStretchMin)
      const width = options.dropWidthMin + rng() * (options.dropWidthMax - options.dropWidthMin)
      const tiltX = options.tiltXMin + rng() * (options.tiltXMax - options.tiltXMin)
      const tiltZ = options.tiltZMin + rng() * (options.tiltZMax - options.tiltZMin)

      dummy.position.set(x, y, z)
      dummy.rotation.set(tiltX, 0, tiltZ)
      dummy.scale.set(width, stretch, 1)
      dummy.updateMatrix()
      rainMesh.setMatrixAt(dropIndex, dummy.matrix)
    }

    rainMesh.instanceMatrix.needsUpdate = true
    this._attachRainAnimation(rainMesh, rng, options)
    chunkGroup.add(rainMesh)
  }

  /**
   * Attach per-layer motion so rain keeps falling over time.
   * @param {THREE.InstancedMesh} rainMesh
   * @param {() => number} rng
   * @param {{xMin: number, xMax: number, yMin: number, yMax: number, fallSpeedMin: number, fallSpeedMax: number, driftSpeedMin: number, driftSpeedMax: number, driftAmplitudeMin: number, driftAmplitudeMax: number, wrapPadding: number}} options
   * @returns {void}
   */
  _attachRainAnimation(rainMesh, rng, options) {
    const fallDistance = Math.max(1, options.yMax - options.yMin)
    const wrapPadding = options.wrapPadding
    const travelDistance = fallDistance + wrapPadding
    const fallSpeed = options.fallSpeedMin + rng() * (options.fallSpeedMax - options.fallSpeedMin)
    const driftPhase = rng() * Math.PI * 2
    const driftSpeed = options.driftSpeedMin + rng() * (options.driftSpeedMax - options.driftSpeedMin)
    const driftAmplitude = options.driftAmplitudeMin + rng() * (options.driftAmplitudeMax - options.driftAmplitudeMin)
    const spawnOffset = rng() * travelDistance
    const baseY = options.yMax + wrapPadding * 0.5

    rainMesh.onBeforeRender = () => {
      const elapsedSeconds = performance.now() * 0.001
      const fallOffset = (spawnOffset + elapsedSeconds * fallSpeed) % travelDistance
      const lateralDrift = Math.sin(elapsedSeconds * driftSpeed + driftPhase) * driftAmplitude
      rainMesh.position.set(lateralDrift, baseY - fallOffset, 0)
    }
  }

  /**
   * Resolve one numeric min/max pair with safe ordering.
   * @param {string} minPath
   * @param {string} maxPath
   * @param {number} fallbackMin
   * @param {number} fallbackMax
   * @returns {{min: number, max: number}}
   */
  _resolveRange(minPath, maxPath, fallbackMin, fallbackMax) {
    const minValue = getRuntimeTuningNumber(minPath, fallbackMin)
    const maxValue = getRuntimeTuningNumber(maxPath, fallbackMax)
    const orderedMin = Math.min(minValue, maxValue)
    const orderedMax = Math.max(minValue, maxValue)
    return {
      min: orderedMin,
      max: orderedMax
    }
  }
}
