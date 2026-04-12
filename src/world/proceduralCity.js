/**
 * Procedural city orchestrator with chunk streaming.
 *
 * Usage:
 * const city = new ProceduralCity(scene)
 * city.update(player.position.z, camera.position.z)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../config/tuningRuntime.js"
import { createSeededRandom, deriveSeed } from "../core/deterministicRandom.js"
import { createCityResources, disposeCityResources } from "./city/resources.js"
import { WalkwayGenerator } from "./city/walkwayGenerator.js"
import { BuildingsGenerator } from "./city/buildingsGenerator.js"
import { StandsGenerator } from "./city/standsGenerator.js"
import { CloudsGenerator } from "./city/cloudsGenerator.js"
import { RainGenerator } from "./city/rainGenerator.js"

export class ProceduralCity {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene
    this.isMobileTouchDevice = this._isMobileTouchDevice()
    this.chunkMap = new Map()
    this.resources = createCityResources()
    this.walkwayGenerator = new WalkwayGenerator(this.resources)
    this.buildingsGenerator = new BuildingsGenerator(this.resources)
    this.standsGenerator = new StandsGenerator(this.resources)
    this.cloudsGenerator = new CloudsGenerator(this.resources)
    this.rainGenerator = new RainGenerator(this.resources)
    this.hasDisposedResources = false
    this.buildingMaterialProfiles = this._createBuildingMaterialProfiles()
  }

  /**
   * Update visible chunks around player position.
   * @param {number} playerZ
   * @param {number} cameraZ
   * @returns {void}
   */
  update(playerZ, cameraZ = playerZ) {
    const chunkLength = gameConfig.world.chunkLength
    const playerChunk = Math.floor(playerZ / chunkLength)
    const behindReferenceZ = this.isMobileTouchDevice ? cameraZ : playerZ
    const behindReferenceChunk = Math.floor(behindReferenceZ / chunkLength)
    const visibleChunksBehind = this.isMobileTouchDevice ? 0 : gameConfig.world.visibleChunksBehind
    const minChunk = behindReferenceChunk - visibleChunksBehind
    const defaultSpawnDistance = gameConfig.world.visibleChunksAhead * chunkLength
    const defaultRenderClipDistance = gameConfig.world.visibleChunksAhead * chunkLength
    const spawnDistanceInChunks = this._resolveDistanceInChunks("buildings.spawnDistance", defaultSpawnDistance, chunkLength)
    const renderClipDistanceInChunks = this._resolveDistanceInChunks(
      "buildings.renderClipDistance",
      defaultRenderClipDistance,
      chunkLength
    )
    const spawnMaxChunk = playerChunk + spawnDistanceInChunks
    const renderClipMaxChunk = playerChunk + Math.min(spawnDistanceInChunks, renderClipDistanceInChunks)

    for (let chunkIndex = minChunk; chunkIndex <= spawnMaxChunk; chunkIndex += 1) {
      if (!this.chunkMap.has(chunkIndex)) {
        const chunkGroup = this._createChunk(chunkIndex)
        this.chunkMap.set(chunkIndex, chunkGroup)
        this.scene.add(chunkGroup)
      }
    }

    for (const [chunkIndex, chunkGroup] of this.chunkMap) {
      if (chunkIndex < minChunk || chunkIndex > spawnMaxChunk) {
        this._disposeChunkGeometry(chunkGroup)
        this.scene.remove(chunkGroup)
        this.chunkMap.delete(chunkIndex)
        continue
      }

      chunkGroup.visible = chunkIndex <= renderClipMaxChunk
    }
  }

  /**
   * Resolve one distance tuning key into chunk count.
   * @param {string} tuningKey
   * @param {number} fallbackDistance
   * @param {number} chunkLength
   * @returns {number}
   */
  _resolveDistanceInChunks(tuningKey, fallbackDistance, chunkLength) {
    const rawDistance = getRuntimeTuningNumber(tuningKey, fallbackDistance)
    const safeDistance = Math.max(0, rawDistance)
    return Math.max(0, Math.ceil(safeDistance / Math.max(1, chunkLength)))
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
   */
  _createChunk(chunkIndex) {
    const chunkGroup = new THREE.Group()
    chunkGroup.position.z = chunkIndex * gameConfig.world.chunkLength

    const rng = createSeededRandom(deriveSeed(gameConfig.world.seed, chunkIndex))
    const walkwayClearanceZone = this.walkwayGenerator.build(chunkGroup)
    this.buildingsGenerator.build(chunkGroup, rng, walkwayClearanceZone)
    this.cloudsGenerator.build(chunkGroup, rng)
    this.rainGenerator.build(chunkGroup, rng)
    this.standsGenerator.build(chunkGroup, rng)

    return chunkGroup
  }

  /**
   * Dispose per-chunk dynamic geometry objects.
   * @param {THREE.Group} chunkGroup
   * @returns {void}
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
   */
  _createBuildingMaterialProfiles() {
    const materials = this.resources.materials
    const buildingBodyProfiles = this._createBuildingBodyMaterialProfiles(materials)

    return [
      ...buildingBodyProfiles,
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

  /**
   * Create day/night tint profiles for all building body materials.
   * @param {Record<string, THREE.Material>} materials
   * @returns {Array<{material: THREE.Material & {color: THREE.Color, emissive?: THREE.Color, emissiveIntensity?: number}, nightColor: THREE.Color, dayColor: THREE.Color, twilightColor: THREE.Color, nightEmissive: THREE.Color, dayEmissive: THREE.Color, twilightEmissive: THREE.Color, nightEmissiveIntensity: number, dayEmissiveIntensity: number}>}
   */
  _createBuildingBodyMaterialProfiles(materials) {
    const randomBuildingMaterials = Object.entries(materials)
      .filter(([materialKey, material]) => materialKey.startsWith("buildingRandom") && this._isColorCapableMaterial(material))
      .map(([, material]) => material)
    const baseMaterial = this._isColorCapableMaterial(materials.buildingBase) ? materials.buildingBase : null
    const buildingMaterials = baseMaterial ? [baseMaterial, ...randomBuildingMaterials] : randomBuildingMaterials

    return buildingMaterials.map((material) => {
      const nightColor = material.color.clone()
      const dayColor = material.color.clone().lerp(new THREE.Color(0xb7cce0), 0.55)
      const twilightColor = material.color.clone().lerp(new THREE.Color(0xc78ec2), 0.4)
      const emissiveColor = this._isColorCapableMaterial(material) && material.emissive
        ? material.emissive.clone()
        : new THREE.Color(0x000000)
      const dayEmissive = emissiveColor.clone().multiplyScalar(0.34).lerp(new THREE.Color(0x0a1016), 0.25)
      const twilightEmissive = emissiveColor.clone().lerp(new THREE.Color(0x2a1f38), 0.32)

      return {
        material,
        nightColor,
        dayColor,
        twilightColor,
        nightEmissive: emissiveColor,
        dayEmissive,
        twilightEmissive,
        nightEmissiveIntensity: this._isNumber(material.emissiveIntensity) ? material.emissiveIntensity : 1,
        dayEmissiveIntensity: 0.3
      }
    })
  }

  /**
   * Check whether a material supports color operations.
   * @param {unknown} material
   * @returns {material is THREE.Material & {color: THREE.Color, emissive?: THREE.Color, emissiveIntensity?: number}}
   */
  _isColorCapableMaterial(material) {
    return Boolean(material && typeof material === "object" && "color" in material && material.color instanceof THREE.Color)
  }

  /**
   * Check whether a value is a finite number.
   * @param {unknown} value
   * @returns {boolean}
   */
  _isNumber(value) {
    return Number.isFinite(value)
  }

  /**
   * Detect touch-first mobile runtime.
   * @returns {boolean}
   */
  _isMobileTouchDevice() {
    const hasTouchPoints = Number(navigator?.maxTouchPoints ?? 0) > 0
    const isCoarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false
    const isMobileViewport = window.matchMedia?.("(max-width: 840px)")?.matches ?? false
    return hasTouchPoints && isCoarsePointer && isMobileViewport
  }
}
