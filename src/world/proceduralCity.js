/**
 * Procedural city orchestrator with chunk streaming.
 *
 * Usage:
 * const city = new ProceduralCity(scene)
 * city.update(player.position.z)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"
import { createSeededRandom, deriveSeed } from "../core/deterministicRandom.js"
import { createCityResources, disposeCityResources } from "./city/resources.js"
import { WalkwayGenerator } from "./city/walkwayGenerator.js"
import { BuildingsGenerator } from "./city/buildingsGenerator.js"
import { StandsGenerator } from "./city/standsGenerator.js"
import { CloudsGenerator } from "./city/cloudsGenerator.js"

export class ProceduralCity {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene
    this.chunkMap = new Map()
    this.resources = createCityResources()
    this.walkwayGenerator = new WalkwayGenerator(this.resources)
    this.buildingsGenerator = new BuildingsGenerator(this.resources)
    this.standsGenerator = new StandsGenerator(this.resources)
    this.cloudsGenerator = new CloudsGenerator(this.resources)
    this.hasDisposedResources = false
    this.buildingMaterialProfiles = this._createBuildingMaterialProfiles()
  }

  /**
   * Update visible chunks around player position.
   * @param {number} playerZ
   * @returns {void}
   */
  update(playerZ) {
    const chunkLength = gameConfig.world.chunkLength
    const playerChunk = Math.floor(playerZ / chunkLength)
    const minChunk = playerChunk - gameConfig.world.visibleChunksBehind
    const maxChunk = playerChunk + gameConfig.world.visibleChunksAhead

    for (let chunkIndex = minChunk; chunkIndex <= maxChunk; chunkIndex += 1) {
      if (!this.chunkMap.has(chunkIndex)) {
        const chunkGroup = this._createChunk(chunkIndex)
        this.chunkMap.set(chunkIndex, chunkGroup)
        this.scene.add(chunkGroup)
      }
    }

    for (const [chunkIndex, chunkGroup] of this.chunkMap) {
      if (chunkIndex < minChunk || chunkIndex > maxChunk) {
        this._disposeChunkGeometry(chunkGroup)
        this.scene.remove(chunkGroup)
        this.chunkMap.delete(chunkIndex)
      }
    }
  }

  /**
   * Apply day/night tinting to building materials.
   * @param {{daylightFactor?: number} | undefined} skyProfile
   * @returns {void}
   */
  applyDayNightProfile(skyProfile) {
    const daylightFactor = THREE.MathUtils.clamp(skyProfile?.daylightFactor ?? 0, 0, 1)
    const twilightFactor = THREE.MathUtils.clamp(skyProfile?.twilightFactor ?? 0, 0, 1)
    const twilightBlend = twilightFactor * 0.55

    for (const materialProfile of this.buildingMaterialProfiles) {
      materialProfile.material.color.lerpColors(materialProfile.nightColor, materialProfile.dayColor, daylightFactor)
      materialProfile.material.color.lerp(materialProfile.twilightColor, twilightBlend)

      if ("emissive" in materialProfile.material && materialProfile.material.emissive) {
        materialProfile.material.emissive.lerpColors(materialProfile.nightEmissive, materialProfile.dayEmissive, daylightFactor)
        materialProfile.material.emissive.lerp(materialProfile.twilightEmissive, twilightBlend * 0.7)
        materialProfile.material.emissiveIntensity = THREE.MathUtils.lerp(
          materialProfile.nightEmissiveIntensity,
          materialProfile.dayEmissiveIntensity,
          daylightFactor
        )
      }
    }
  }

  /**
   * Dispose all references.
   * @returns {void}
   */
  dispose() {
    for (const chunkGroup of this.chunkMap.values()) {
      this._disposeChunkGeometry(chunkGroup)
      this.scene.remove(chunkGroup)
    }

    this.chunkMap.clear()
    this._disposeSharedResources()
  }

  /**
   * Create one procedural chunk.
   * @param {number} chunkIndex
   * @returns {THREE.Group}
   * @private
   * @ignore
   */
  _createChunk(chunkIndex) {
    const chunkGroup = new THREE.Group()
    chunkGroup.position.z = chunkIndex * gameConfig.world.chunkLength

    const rng = createSeededRandom(deriveSeed(gameConfig.world.seed, chunkIndex))
    const walkwayClearanceZone = this.walkwayGenerator.build(chunkGroup)
    this.buildingsGenerator.build(chunkGroup, rng, walkwayClearanceZone)
    this.cloudsGenerator.build(chunkGroup, rng)
    this.standsGenerator.build(chunkGroup, rng)

    return chunkGroup
  }

  /**
   * Dispose per-chunk dynamic geometry objects.
   * @param {THREE.Group} chunkGroup
   * @returns {void}
   * @private
   * @ignore
   */
  _disposeChunkGeometry(chunkGroup) {
    chunkGroup.traverse((node) => {
      if (!node.geometry) {
        return
      }
      if (this.resources.sharedGeometries.has(node.geometry)) {
        return
      }
      node.geometry.dispose()
    })
  }

  /**
   * Dispose shared resources only once.
   * @returns {void}
   * @private
   * @ignore
   */
  _disposeSharedResources() {
    if (this.hasDisposedResources) {
      return
    }

    disposeCityResources(this.resources)
    this.hasDisposedResources = true
  }

  /**
   * Create per-material day/night tint profiles for building bodies.
   * @returns {Array<{material: THREE.Material & {color: THREE.Color, emissive?: THREE.Color, emissiveIntensity?: number}, nightColor: THREE.Color, dayColor: THREE.Color, twilightColor: THREE.Color, nightEmissive: THREE.Color, dayEmissive: THREE.Color, twilightEmissive: THREE.Color, nightEmissiveIntensity: number, dayEmissiveIntensity: number}>}
   * @private
   * @ignore
   */
  _createBuildingMaterialProfiles() {
    const materials = this.resources.materials
    return [
      {
        material: materials.buildingDark,
        nightColor: new THREE.Color(0x101723),
        dayColor: new THREE.Color(0x607b97),
        twilightColor: new THREE.Color(0x6f5f8e),
        nightEmissive: new THREE.Color(0x080f18),
        dayEmissive: new THREE.Color(0x0a1016),
        twilightEmissive: new THREE.Color(0x20162e),
        nightEmissiveIntensity: 1,
        dayEmissiveIntensity: 0.25
      },
      {
        material: materials.buildingMid,
        nightColor: new THREE.Color(0x16253a),
        dayColor: new THREE.Color(0x7f9fc1),
        twilightColor: new THREE.Color(0x8a719d),
        nightEmissive: new THREE.Color(0x0d1522),
        dayEmissive: new THREE.Color(0x101722),
        twilightEmissive: new THREE.Color(0x2a1e3a),
        nightEmissiveIntensity: 1,
        dayEmissiveIntensity: 0.28
      },
      {
        material: materials.buildingWarm,
        nightColor: new THREE.Color(0x2a2f3f),
        dayColor: new THREE.Color(0x8f99aa),
        twilightColor: new THREE.Color(0x976f85),
        nightEmissive: new THREE.Color(0x121322),
        dayEmissive: new THREE.Color(0x13161e),
        twilightEmissive: new THREE.Color(0x2f1f33),
        nightEmissiveIntensity: 1,
        dayEmissiveIntensity: 0.3
      },
      {
        material: materials.buildingSteel,
        nightColor: new THREE.Color(0x202a36),
        dayColor: new THREE.Color(0x7f95aa),
        twilightColor: new THREE.Color(0x7f6f96),
        nightEmissive: new THREE.Color(0x0b1320),
        dayEmissive: new THREE.Color(0x0c131b),
        twilightEmissive: new THREE.Color(0x24192f),
        nightEmissiveIntensity: 1,
        dayEmissiveIntensity: 0.3
      },
      {
        material: materials.windowPanelAmber,
        nightColor: new THREE.Color(0xfff2b6),
        dayColor: new THREE.Color(0xc6d5e6),
        twilightColor: new THREE.Color(0xe6b0d1),
        nightEmissive: new THREE.Color(0x000000),
        dayEmissive: new THREE.Color(0x000000),
        twilightEmissive: new THREE.Color(0x000000),
        nightEmissiveIntensity: 0,
        dayEmissiveIntensity: 0
      },
      {
        material: materials.windowPanelWarm,
        nightColor: new THREE.Color(0xffcc8a),
        dayColor: new THREE.Color(0xbfd2e5),
        twilightColor: new THREE.Color(0xd8a8ca),
        nightEmissive: new THREE.Color(0x000000),
        dayEmissive: new THREE.Color(0x000000),
        twilightEmissive: new THREE.Color(0x000000),
        nightEmissiveIntensity: 0,
        dayEmissiveIntensity: 0
      },
      {
        material: materials.windowPanelPink,
        nightColor: new THREE.Color(0xffb8df),
        dayColor: new THREE.Color(0xd0d9e7),
        twilightColor: new THREE.Color(0xe0b0de),
        nightEmissive: new THREE.Color(0x000000),
        dayEmissive: new THREE.Color(0x000000),
        twilightEmissive: new THREE.Color(0x000000),
        nightEmissiveIntensity: 0,
        dayEmissiveIntensity: 0
      },
      {
        material: materials.windowPanelCyan,
        nightColor: new THREE.Color(0x9fe8ff),
        dayColor: new THREE.Color(0xc2d9e8),
        twilightColor: new THREE.Color(0xc8b8e8),
        nightEmissive: new THREE.Color(0x000000),
        dayEmissive: new THREE.Color(0x000000),
        twilightEmissive: new THREE.Color(0x000000),
        nightEmissiveIntensity: 0,
        dayEmissiveIntensity: 0
      },
      {
        material: materials.windowPanelSoft,
        nightColor: new THREE.Color(0xffe8a3),
        dayColor: new THREE.Color(0xc7d6e6),
        twilightColor: new THREE.Color(0xe0b9cf),
        nightEmissive: new THREE.Color(0x000000),
        dayEmissive: new THREE.Color(0x000000),
        twilightEmissive: new THREE.Color(0x000000),
        nightEmissiveIntensity: 0,
        dayEmissiveIntensity: 0
      }
    ]
  }
}
