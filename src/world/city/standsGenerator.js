/**
 * Stand generator for the procedural city chunk.
 *
 * Usage:
 * const generator = new StandsGenerator(resources)
 * generator.build(chunkGroup, rng)
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

export class StandsGenerator {
  /**
   * @param {object} resources
   */
  constructor(resources) {
    this.resources = resources
  }

  /**
   * Build stand placeholders for one chunk.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @returns {void}
   */
  build(chunkGroup, rng) {
    const standSpawnChance = 0.5
    const standCount = rng() > standSpawnChance ? 1 : 0
    const npcHeight = 1.8
    const npcWidth = 0.9
    const standLengthNpcMin = getRuntimeTuningNumber("stands.lengthNpcMin", 15)
    const standLengthNpcMax = getRuntimeTuningNumber("stands.lengthNpcMax", 30)
    const minLengthNpc = Math.min(standLengthNpcMin, standLengthNpcMax)
    const maxLengthNpc = Math.max(standLengthNpcMin, standLengthNpcMax)
    const standHeight = npcHeight * 2.5
    const standWidth = npcWidth * 10
    const standIntrusion = npcWidth
    const walkwayHalfWidth = gameConfig.world.walkwayWidth * 0.5
    const walkwayBottomY = -gameConfig.world.walkwayHeight * 0.5
    const walkwayTopY = gameConfig.world.walkwayHeight * 0.5
    const standSteppedSettings = this._resolveStandSteppedSettings()

    for (let standIndex = 0; standIndex < standCount; standIndex += 1) {
      const shop = this._pickStandShop(rng)
      const side = rng() > 0.5 ? 1 : -1
      const standLengthNpc = minLengthNpc + rng() * (maxLengthNpc - minLengthNpc)
      const standLength = npcWidth * standLengthNpc
      const chunkLength = gameConfig.world.chunkLength
      const zPadding = Math.max(4, standLength * 0.6)
      const zRange = Math.max(1, chunkLength - zPadding * 2)
      const offsetX = side * (walkwayHalfWidth + standWidth * 0.5 - standIntrusion)
      const offsetZ = -chunkLength * 0.5 + zPadding + rng() * zRange
      const steppedSegments = this._buildStandSteppedBody(
        chunkGroup,
        rng,
        offsetX,
        offsetZ,
        standWidth,
        standHeight,
        standLength,
        side,
        walkwayBottomY,
        shop.material,
        standSteppedSettings
      )
      const baseSegment = steppedSegments[0]
      const topSegment = steppedSegments[steppedSegments.length - 1]
      if (!baseSegment || !topSegment) {
        continue
      }

      const basePosition = new THREE.Vector3(baseSegment.positionX, baseSegment.positionY, baseSegment.positionZ)
      const doorInfo = this._addStandDoor(
        chunkGroup,
        rng,
        basePosition,
        side,
        baseSegment.width,
        baseSegment.height,
        baseSegment.length,
        npcWidth,
        walkwayTopY
      )
      this._addStandWindows(
        chunkGroup,
        rng,
        basePosition,
        side,
        baseSegment.width,
        baseSegment.height,
        baseSegment.length,
        npcWidth,
        shop.roofMaterial,
        doorInfo
      )

      for (let segmentIndex = 1; segmentIndex < steppedSegments.length; segmentIndex += 1) {
        const segment = steppedSegments[segmentIndex]
        const segmentPosition = new THREE.Vector3(segment.positionX, segment.positionY, segment.positionZ)
        this._addStandWindows(
          chunkGroup,
          rng,
          segmentPosition,
          side,
          segment.width,
          segment.height,
          segment.length,
          npcWidth,
          shop.roofMaterial,
          null
        )
      }

      const topPosition = new THREE.Vector3(topSegment.positionX, topSegment.positionY, topSegment.positionZ)
      this._addStandRoof(
        chunkGroup,
        topPosition,
        topSegment.width,
        topSegment.height,
        topSegment.length,
        npcWidth,
        shop.roofMaterial
      )
    }
  }

  /**
   * Resolve stepped stand settings from runtime tuning.
   * @returns {{stepCountMin: number, stepCountMax: number, growRatio: number, inverseChance: number, growthChance: number}}
   * @private
   * @ignore
   */
  _resolveStandSteppedSettings() {
    const stepCountMin = Math.round(getRuntimeTuningNumber("stands.stepCountMin", 1))
    const stepCountMax = Math.round(getRuntimeTuningNumber("stands.stepCountMax", 4))
    const growPercent = getRuntimeTuningNumber("stands.steppedGrowPercent", 14)
    const steppedInverseChance = getRuntimeTuningNumber("stands.steppedInverseChance", 0)
    const stepGrowthChance = getRuntimeTuningNumber("stands.stepGrowthChance", 0.72)
    const normalizedStepCountMin = THREE.MathUtils.clamp(stepCountMin, 1, 10)
    const normalizedStepCountMax = THREE.MathUtils.clamp(stepCountMax, normalizedStepCountMin, 10)
    const normalizedGrowPercent = THREE.MathUtils.clamp(growPercent, 0, 40)
    const normalizedInverseChance = THREE.MathUtils.clamp(steppedInverseChance, 0, 1)
    const normalizedGrowthChance = THREE.MathUtils.clamp(stepGrowthChance, 0, 1)

    return {
      stepCountMin: normalizedStepCountMin,
      stepCountMax: normalizedStepCountMax,
      growRatio: normalizedGrowPercent / 100,
      inverseChance: normalizedInverseChance,
      growthChance: normalizedGrowthChance
    }
  }

  /**
   * Build stepped stand body segments and return their descriptors.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} baseX
   * @param {number} baseZ
   * @param {number} baseWidth
   * @param {number} baseHeight
   * @param {number} baseLength
   * @param {number} side
   * @param {number} walkwayBottomY
   * @param {THREE.Material} standMaterial
   * @param {{stepCountMin: number, stepCountMax: number, growRatio: number, inverseChance: number, growthChance: number}} steppedSettings
   * @returns {Array<{positionX: number, positionY: number, positionZ: number, width: number, height: number, length: number}>}
   * @private
   * @ignore
   */
  _buildStandSteppedBody(
    chunkGroup,
    rng,
    baseX,
    baseZ,
    baseWidth,
    baseHeight,
    baseLength,
    side,
    walkwayBottomY,
    standMaterial,
    steppedSettings
  ) {
    const stepCount = this._pickStandStepCount(rng, steppedSettings.stepCountMin, steppedSettings.stepCountMax)
    const progressionDirection = rng() < steppedSettings.inverseChance ? -1 : 1
    const nextScale = 1 - progressionDirection * steppedSettings.growRatio
    const segments = []
    let segmentWidth = baseWidth
    let segmentLength = baseLength
    let builtHeight = 0

    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const isBaseStep = stepIndex === 0
      const segmentHeight = isBaseStep
        ? baseHeight * (0.9 + rng() * 0.25)
        : baseHeight * (0.34 + rng() * 0.34)
      const segmentZJitter = isBaseStep ? 0 : (rng() - 0.5) * 0.8
      const segmentPositionY = walkwayBottomY + builtHeight + segmentHeight * 0.5
      const segmentPositionZ = baseZ + segmentZJitter
      const segmentPositionX = baseX - side * stepIndex * 0.08
      const standSegment = new THREE.Mesh(this.resources.geometries.stand, standMaterial)

      standSegment.scale.set(segmentWidth, segmentHeight, segmentLength)
      standSegment.position.set(segmentPositionX, segmentPositionY, segmentPositionZ)
      standSegment.userData.isStandStep = true
      standSegment.userData.standStepIndex = stepIndex
      chunkGroup.add(standSegment)

      segments.push({
        positionX: segmentPositionX,
        positionY: segmentPositionY,
        positionZ: segmentPositionZ,
        width: segmentWidth,
        height: segmentHeight,
        length: segmentLength
      })
      builtHeight += segmentHeight

      if (stepIndex < stepCount - 1) {
        const hasGrowthBetweenSteps = rng() < steppedSettings.growthChance
        if (!hasGrowthBetweenSteps) {
          continue
        }

        segmentWidth = this._clampStandStepSize(segmentWidth * nextScale, baseWidth)
        segmentLength = this._clampStandStepSize(segmentLength * nextScale, baseLength)
      }
    }

    return segments
  }

  /**
   * Clamp a stepped stand footprint dimension around base size.
   * @param {number} size
   * @param {number} baseSize
   * @returns {number}
   * @private
   * @ignore
   */
  _clampStandStepSize(size, baseSize) {
    const minSize = baseSize * 0.5
    const maxSize = baseSize * 1.5
    return THREE.MathUtils.clamp(size, minSize, maxSize)
  }

  /**
   * Pick stand stepped segment count in inclusive range.
   * @param {() => number} rng
   * @param {number} minStepCount
   * @param {number} maxStepCount
   * @returns {number}
   * @private
   * @ignore
   */
  _pickStandStepCount(rng, minStepCount, maxStepCount) {
    if (minStepCount >= maxStepCount) {
      return minStepCount
    }

    return minStepCount + Math.floor(rng() * (maxStepCount - minStepCount + 1))
  }

  /**
   * Pick one shop style for stand color variation.
   * @param {() => number} rng
   * @returns {{id: string, material: THREE.Material, roofMaterial?: THREE.Material}}
   * @private
   * @ignore
   */
  _pickStandShop(rng) {
    const standShops = this.resources.palettes.standShops
    if (!standShops || standShops.length === 0) {
      return {
        id: "fallbackShop",
        material: this.resources.materials.standCoffee
      }
    }

    const shopIndex = Math.floor(rng() * standShops.length)
    return standShops[shopIndex]
  }

  /**
   * Add one entrance door on stand facade facing the walkway.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {THREE.Vector3} standPosition
   * @param {number} side
   * @param {number} standWidth
   * @param {number} standHeight
   * @param {number} standLength
   * @param {number} npcWidth
   * @param {number} walkwayTopY
   * @returns {{z: number, width: number, y: number, height: number}}
   * @private
   * @ignore
   */
  _addStandDoor(chunkGroup, rng, standPosition, side, standWidth, standHeight, standLength, npcWidth, walkwayTopY) {
    const door = new THREE.Mesh(this.resources.geometries.stand, this.resources.materials.standDoor)
    const doorWidth = npcWidth * 2.2
    const doorHeight = standHeight * 0.65
    const doorDepth = Math.max(0.28, npcWidth * 0.35)
    const facadeOffset = 0.03
    const maxLateralOffset = Math.max(npcWidth * 2.4, standLength * 0.34)
    const minLateralOffset = npcWidth * 1.15
    const lateralOffsetDirection = rng() > 0.5 ? 1 : -1
    const lateralOffsetMagnitude = minLateralOffset + rng() * Math.max(0.01, maxLateralOffset - minLateralOffset)
    const unclampedDoorZ = standPosition.z + lateralOffsetDirection * lateralOffsetMagnitude
    const maxDoorZOffset = standLength * 0.5 - doorWidth * 0.6
    const clampedDoorZ = THREE.MathUtils.clamp(
      unclampedDoorZ,
      standPosition.z - maxDoorZOffset,
      standPosition.z + maxDoorZOffset
    )
    const doorX = standPosition.x - side * (standWidth * 0.5 - doorDepth * 0.5 + facadeOffset)
    const doorY = walkwayTopY + doorHeight * 0.5

    door.scale.set(doorDepth, doorHeight, doorWidth)
    door.position.set(doorX, doorY, clampedDoorZ)
    chunkGroup.add(door)

    return {
      z: clampedDoorZ,
      width: doorWidth,
      y: doorY,
      height: doorHeight
    }
  }

  /**
   * Add one centered roof slab on top of the stand.
   * @param {THREE.Group} chunkGroup
   * @param {THREE.Vector3} standPosition
   * @param {number} standWidth
   * @param {number} standHeight
   * @param {number} standLength
   * @param {number} npcWidth
   * @param {THREE.Material} roofMaterial
   * @returns {void}
   * @private
   * @ignore
   */
  _addStandRoof(chunkGroup, standPosition, standWidth, standHeight, standLength, npcWidth, roofMaterial) {
    const roof = new THREE.Mesh(this.resources.geometries.stand, roofMaterial ?? this.resources.materials.standDoor)
    const roofOverhang = npcWidth
    const roofThickness = npcWidth * 0.5
    const roofWidth = standWidth + roofOverhang * 2
    const roofLength = standLength + roofOverhang * 2
    const roofY = standPosition.y + standHeight * 0.5 + roofThickness * 0.5

    roof.scale.set(roofWidth, roofThickness, roofLength)
    roof.position.set(standPosition.x, roofY, standPosition.z)
    chunkGroup.add(roof)
  }

  /**
   * Add fluo windows on stand facade without overlapping the door.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {THREE.Vector3} standPosition
   * @param {number} side
   * @param {number} standWidth
   * @param {number} standHeight
   * @param {number} standLength
   * @param {number} npcWidth
   * @param {THREE.Material} windowMaterial
   * @param {{z: number, width: number, y: number, height: number} | null} doorInfo
   * @returns {void}
   * @private
   * @ignore
   */
  _addStandWindows(chunkGroup, rng, standPosition, side, standWidth, standHeight, standLength, npcWidth, windowMaterial, doorInfo) {
    const requestedWindowCount = 1 + Math.floor(rng() * 3)
    const windowWidth = npcWidth * (2.1 + rng() * 0.9)
    const windowHeight = npcWidth * (1.15 + rng() * 0.55)
    const windowDepth = Math.max(0.12, npcWidth * 0.2)
    const facadeOffset = 0.02
    const unclampedWindowY = doorInfo
      ? doorInfo.y + (doorInfo.height - windowHeight) * 0.5
      : standPosition.y - standHeight * 0.5 + Math.max(windowHeight * 0.7, standHeight * (0.5 + rng() * 0.3))
    const windowYMin = standPosition.y - standHeight * 0.5 + windowHeight * 0.5 + npcWidth * 0.1
    const windowYMax = standPosition.y + standHeight * 0.5 - windowHeight * 0.5 - npcWidth * 0.1
    const windowY = THREE.MathUtils.clamp(unclampedWindowY, windowYMin, windowYMax)
    const doorExclusion = doorInfo ? doorInfo.width * 0.65 + windowWidth * 0.65 + npcWidth * 0.2 : 0
    const sidePadding = windowWidth * 0.7 + npcWidth * 0.45
    const minZ = standPosition.z - standLength * 0.5 + sidePadding
    const maxZ = standPosition.z + standLength * 0.5 - sidePadding
    const availableSpan = Math.max(0.01, maxZ - minZ)
    const segmentWidth = availableSpan / 3
    const segmentCenters = [
      minZ + segmentWidth * 0.5,
      minZ + segmentWidth * 1.5,
      minZ + segmentWidth * 2.5
    ]
    const placementCandidates = segmentCenters
      .filter((candidateZ) => !doorInfo || Math.abs(candidateZ - doorInfo.z) >= doorExclusion)
      .map((candidateZ) => candidateZ + (rng() - 0.5) * npcWidth * 0.6)
      .map((candidateZ) => THREE.MathUtils.clamp(candidateZ, minZ, maxZ))
      .sort((left, right) => left - right)
    const windowCount = Math.min(requestedWindowCount, placementCandidates.length)

    for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
      const window = new THREE.Mesh(this.resources.geometries.stand, windowMaterial ?? this.resources.materials.standDoor)
      const windowX = standPosition.x - side * (standWidth * 0.5 - windowDepth * 0.5 + facadeOffset)
      const windowZ = placementCandidates[windowIndex]
      window.scale.set(windowDepth, windowHeight, windowWidth)
      window.position.set(windowX, windowY, windowZ)
      chunkGroup.add(window)
    }
  }
}
