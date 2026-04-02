/**
 * Cloud layer generator for hiding lower city areas.
 *
 * Usage:
 * const generator = new CloudsGenerator(resources)
 * generator.build(chunkGroup, rng)
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

export class CloudsGenerator {
  /**
   * @param {object} resources
   */
  constructor(resources) {
    this.resources = resources
  }

  /**
   * Build cloud layers and puffs for one chunk.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @returns {void}
   */
  build(chunkGroup, rng) {
    const chunkZRangeMultiplier = getRuntimeTuningNumber("clouds.chunkZRangeMultiplier", 0.56)
    const chunkZRange = gameConfig.world.chunkLength * chunkZRangeMultiplier
    const densityMultiplier = 0.5

    this._addCloudDiscLayer(chunkGroup, rng, {
      material: this.resources.materials.cloudMist,
      geometry: this.resources.geometries.cloudMist,
      ...this._readLayerOptions("clouds.mistLayer", {
        count: 9,
        yMin: -42,
        yMax: -16,
        sizeMin: 220,
        sizeMax: 460,
        xSpan: 700,
        tilt: 0.03
      }, chunkZRange, densityMultiplier, 0.95, 4)
    })
  }

  /**
   * Read one cloud layer option set from runtime tuning.
   * @param {string} layerPath
   * @param {object} defaults
   * @param {number} chunkZRange
   * @returns {object}
   * @private
   * @ignore
   */
  _readLayerOptions(layerPath, defaults, chunkZRange, densityMultiplier = 1, layerWeight = 1, minCount = 0) {
    const countValue = getRuntimeTuningNumber(`${layerPath}Count`, defaults.count)
    const xSpanValue = getRuntimeTuningNumber(`${layerPath}XSpan`, defaults.xSpan)
    const reducedCount = countValue * densityMultiplier * layerWeight
    const isMistLayer = layerPath.includes("mist")
    const sizeBoost = isMistLayer ? 1.2 : 1

    return {
      count: Math.max(minCount, Math.round(reducedCount)),
      yMin: getRuntimeTuningNumber(`${layerPath}YMin`, defaults.yMin) + (isMistLayer ? 8 : 0),
      yMax: getRuntimeTuningNumber(`${layerPath}YMax`, defaults.yMax) + (isMistLayer ? 8 : 0),
      sizeMin: getRuntimeTuningNumber(`${layerPath}SizeMin`, defaults.sizeMin) * sizeBoost,
      sizeMax: getRuntimeTuningNumber(`${layerPath}SizeMax`, defaults.sizeMax) * sizeBoost,
      xMin: -xSpanValue,
      xMax: xSpanValue,
      zMin: -chunkZRange,
      zMax: chunkZRange,
      tilt: defaults.tilt
    }
  }

  /**
   * Add one instanced cloud disc layer with configurable spread.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {object} options
   * @returns {void}
   * @private
   * @ignore
   */
  _addCloudDiscLayer(chunkGroup, rng, options) {
    const cloudMesh = new THREE.InstancedMesh(options.geometry, options.material, options.count)
    cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    cloudMesh.frustumCulled = false

    const dummy = new THREE.Object3D()

    for (let cloudIndex = 0; cloudIndex < options.count; cloudIndex += 1) {
      const x = options.xMin + rng() * (options.xMax - options.xMin)
      const y = options.yMin + rng() * (options.yMax - options.yMin)
      const z = options.zMin + rng() * (options.zMax - options.zMin)
      const sizeX = options.sizeMin + rng() * (options.sizeMax - options.sizeMin)
      const sizeY = options.sizeMin * 0.7 + rng() * (options.sizeMax * 0.6)
      const tiltX = -Math.PI * 0.5 + (rng() - 0.5) * options.tilt
      const tiltY = (rng() - 0.5) * options.tilt
      const rotZ = rng() * Math.PI * 2

      dummy.position.set(x, y, z)
      dummy.rotation.set(tiltX, tiltY, rotZ)
      dummy.scale.set(sizeX, sizeY, 1)
      dummy.updateMatrix()
      cloudMesh.setMatrixAt(cloudIndex, dummy.matrix)
    }

    cloudMesh.instanceMatrix.needsUpdate = true
    chunkGroup.add(cloudMesh)
  }
}
