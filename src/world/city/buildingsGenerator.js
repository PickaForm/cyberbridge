/**
 * Building generator for procedural cyber city chunks.
 *
 * Usage:
 * const generator = new BuildingsGenerator(resources)
 * generator.build(chunkGroup, rng, walkwayClearanceZone)
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

export class BuildingsGenerator {
  /**
   * Extra inward offset used by facade elements (signs/windows) that can protrude toward the walkway.
   * @type {number}
   */
  static WALKWAY_FACADE_PROTRUSION_PADDING = 4.3

  /**
   * @param {object} resources
   */
  constructor(resources) {
    this.resources = resources
  }

  /**
   * Build city buildings for one chunk.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number} | undefined} walkwayClearanceZone
   * @returns {void}
   */
  build(chunkGroup, rng, walkwayClearanceZone) {
    const rows = gameConfig.world.buildingRowsPerSide
    const halfWidth = gameConfig.world.walkwayWidth * 0.5
    const gap = gameConfig.world.buildingGapFromWalkway
    const rowSpacing = getRuntimeTuningNumber("buildings.rowSpacing", 10.5)
    const widthMin = getRuntimeTuningNumber("buildings.widthMin", 7)
    const widthRange = getRuntimeTuningNumber("buildings.widthRange", 8)
    const depthMin = getRuntimeTuningNumber("buildings.depthMin", 10)
    const depthRange = getRuntimeTuningNumber("buildings.depthRange", 15)
    const heightMin = getRuntimeTuningNumber("buildings.heightMin", 82)
    const heightRange = getRuntimeTuningNumber("buildings.heightRange", 176)
    const baseYMin = getRuntimeTuningNumber("buildings.baseYMin", -110)
    const baseYRange = getRuntimeTuningNumber("buildings.baseYRange", 70)
    const wrappedStyleChance = getRuntimeTuningNumber("buildings.wrappedStyleChance", 0.28)
    const wrappedLinesMin = getRuntimeTuningNumber("buildings.wrappedLinesMin", 12)
    const wrappedLinesMax = getRuntimeTuningNumber("buildings.wrappedLinesMax", 28)
    const minSegmentCount = getRuntimeTuningNumber("buildings.minSegmentCount", 2)
    const maxSegmentCount = getRuntimeTuningNumber("buildings.maxSegmentCount", 4)
    const steppedGrowPercent = getRuntimeTuningNumber("buildings.steppedGrowPercent", 12)
    const steppedInverseChance = getRuntimeTuningNumber("buildings.steppedInverseChance", 0)
    const baseColorSharePercent = getRuntimeTuningNumber(
      "world.buildingBaseColorSharePercent",
      getRuntimeTuningNumber("buildings.baseColorSharePercent", 70)
    )
    const steppedSettings = this._resolveSteppedSettings(
      minSegmentCount,
      maxSegmentCount,
      steppedGrowPercent,
      steppedInverseChance
    )
    const wrappedLineSettings = this._resolveWrappedLineSettings(wrappedLinesMin, wrappedLinesMax)
    const buildingColorSettings = this._resolveBuildingColorSettings(baseColorSharePercent)

    for (let sideIndex = -1; sideIndex <= 1; sideIndex += 2) {
      for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        const rowDetailFactor = this._computeRowDetailFactor(rowIndex, rows)
        const width = widthMin + rng() * widthRange
        const depth = depthMin + rng() * depthRange
        const totalHeight = heightMin + rng() * heightRange
        const baseY = baseYMin - rng() * baseYRange
        const offsetFromBridge = gap + rowIndex * rowSpacing + depth * 0.5
        const posX = sideIndex * (halfWidth + offsetFromBridge)
        const posZ = -gameConfig.world.chunkLength * 0.5 + rng() * gameConfig.world.chunkLength
        const buildingStyleRoll = rng()
        const windowMaterial = this._pickWindowBuildingMaterial(rng)
        const buildingMaterial = this._pickBuildingMaterial(rng, buildingColorSettings)

        if (buildingStyleRoll < wrappedStyleChance) {
          this._buildWrappedLineBuilding(
            chunkGroup,
            rng,
            posX,
            posZ,
            width,
            depth,
            totalHeight,
            sideIndex,
            baseY,
            rowDetailFactor,
            buildingMaterial,
            wrappedLineSettings,
            walkwayClearanceZone
          )
        } else {
          this._buildSteppedBuilding(
            chunkGroup,
            rng,
            posX,
            posZ,
            width,
            depth,
            totalHeight,
            sideIndex,
            windowMaterial,
            buildingMaterial,
            baseY,
            rowDetailFactor,
            steppedSettings,
            walkwayClearanceZone
          )
        }
      }
    }
  }

  /**
   * Build a stepped tower with Cloudpunk-like silhouette.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posZ
   * @param {number} baseWidth
   * @param {number} baseDepth
   * @param {number} totalHeight
   * @param {number} sideIndex
   * @param {THREE.Material} windowMaterial
   * @param {THREE.Material} buildingMaterial
   * @param {number} baseY
   * @param {number} rowDetailFactor
   * @param {{segmentCountMin: number, segmentCountMax: number, growRatio: number, inverseChance: number}} steppedSettings
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number} | undefined} walkwayClearanceZone
   * @returns {void}
   */
  _buildSteppedBuilding(
    chunkGroup,
    rng,
    posX,
    posZ,
    baseWidth,
    baseDepth,
    totalHeight,
    sideIndex,
    windowMaterial,
    buildingMaterial,
    baseY,
    rowDetailFactor,
    steppedSettings,
    walkwayClearanceZone
  ) {
    const bottomY = baseY
    const maxSegmentCountForHeight = Math.max(1, Math.floor((totalHeight + 3) / 11))
    const segmentCount = Math.min(
      maxSegmentCountForHeight,
      this._pickSegmentCount(rng, steppedSettings.segmentCountMin, steppedSettings.segmentCountMax)
    )
    const progressionDirection = rng() < steppedSettings.inverseChance ? -1 : 1
    const nextSegmentScale = 1 - progressionDirection * steppedSettings.growRatio
    let builtHeight = 0
    let width = baseWidth
    let depth = baseDepth

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const isLastSegment = segmentIndex === segmentCount - 1
      const remainingHeight = totalHeight - builtHeight
      const minSegmentHeight = isLastSegment ? 8 : 11
      const maxSegmentHeight = Math.max(minSegmentHeight, remainingHeight - (segmentCount - segmentIndex - 1) * 8)
      const rawHeight = totalHeight * (0.2 + rng() * 0.24)
      const segmentHeight = isLastSegment
        ? remainingHeight
        : THREE.MathUtils.clamp(rawHeight, minSegmentHeight, maxSegmentHeight)

      const xJitter = (rng() - 0.5) * 1.6 * (segmentIndex / Math.max(1, segmentCount - 1))
      const zJitter = (rng() - 0.5) * 1.8 * (segmentIndex / Math.max(1, segmentCount - 1))
      const segmentPosX = this._resolveSegmentXWithWalkwayClearance(
        posX + xJitter,
        posZ + zJitter,
        width,
        depth,
        bottomY + builtHeight + segmentHeight * 0.5,
        segmentHeight,
        sideIndex,
        walkwayClearanceZone
      )
      const segmentPosY = bottomY + builtHeight + segmentHeight * 0.5
      const segmentPosZ = posZ + zJitter
      const verticalDetailFactor = this._computeVerticalDetailFactor(segmentPosY, bottomY, totalHeight)
      const segmentDetailFactor = THREE.MathUtils.clamp(rowDetailFactor * verticalDetailFactor, 0.2, 1)

      const segmentMesh = new THREE.Mesh(this.resources.geometries.building, buildingMaterial)
      segmentMesh.scale.set(width, segmentHeight, depth)
      segmentMesh.position.set(segmentPosX, segmentPosY, segmentPosZ)
      chunkGroup.add(segmentMesh)

      this._addNeonStrips(chunkGroup, rng, segmentPosX, segmentPosY, segmentPosZ, width, segmentHeight, depth, sideIndex, segmentDetailFactor)
      this._addNeonBands(chunkGroup, rng, segmentPosX, segmentPosY, segmentPosZ, width, segmentHeight, depth, sideIndex, segmentDetailFactor)
      this._addSignPanels(chunkGroup, rng, segmentPosX, segmentPosY, segmentPosZ, width, segmentHeight, depth, sideIndex, segmentDetailFactor)
      this._addWindowPanels(chunkGroup, rng, segmentPosX, segmentPosY, segmentPosZ, width, segmentHeight, depth, sideIndex, windowMaterial, segmentDetailFactor)

      builtHeight += segmentHeight

      // Apply stepped footprint progression between levels.
      if (!isLastSegment) {
        width *= nextSegmentScale
        depth *= nextSegmentScale
      }
    }
  }

  /**
   * Resolve stepped-building tuning into safe runtime settings.
   * @param {number} minSegmentCount
   * @param {number} maxSegmentCount
   * @param {number} growPercent
   * @param {number} inverseChance
   * @returns {{segmentCountMin: number, segmentCountMax: number, growRatio: number, inverseChance: number}}
   */
  _resolveSteppedSettings(minSegmentCount, maxSegmentCount, growPercent, inverseChance) {
    const normalizedMinSegmentCount = Math.max(1, Math.round(minSegmentCount))
    const normalizedMaxSegmentCount = Math.max(normalizedMinSegmentCount, Math.round(maxSegmentCount))
    const clampedGrowPercent = THREE.MathUtils.clamp(growPercent, 0, 20)
    const normalizedInverseChance = THREE.MathUtils.clamp(inverseChance, 0, 1)

    return {
      segmentCountMin: normalizedMinSegmentCount,
      segmentCountMax: normalizedMaxSegmentCount,
      growRatio: clampedGrowPercent / 100,
      inverseChance: normalizedInverseChance
    }
  }

  /**
   * Resolve wrapped-line tuning into safe runtime settings.
   * @param {number} minLines
   * @param {number} maxLines
   * @returns {{minLines: number, maxLines: number}}
   */
  _resolveWrappedLineSettings(minLines, maxLines) {
    const normalizedMinLines = Math.max(1, Math.round(minLines))
    const normalizedMaxLines = Math.max(normalizedMinLines, Math.round(maxLines))
    return {
      minLines: normalizedMinLines,
      maxLines: normalizedMaxLines
    }
  }

  /**
   * Resolve base-color building share into safe runtime settings.
   * @param {number} baseColorSharePercent
   * @returns {{baseChanceRatio: number}}
   */
  _resolveBuildingColorSettings(baseColorSharePercent) {
    const clampedPercent = THREE.MathUtils.clamp(baseColorSharePercent, 0, 100)
    return {
      baseChanceRatio: clampedPercent / 100
    }
  }

  /**
   * Pick stepped building segment count in inclusive range.
   * @param {() => number} rng
   * @param {number} minSegmentCount
   * @param {number} maxSegmentCount
   * @returns {number}
   */
  _pickSegmentCount(rng, minSegmentCount, maxSegmentCount) {
    if (minSegmentCount >= maxSegmentCount) {
      return minSegmentCount
    }

    return minSegmentCount + Math.floor(rng() * (maxSegmentCount - minSegmentCount + 1))
  }

  /**
   * Build a tower variant with no windows and wrapped line accents.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posZ
   * @param {number} width
   * @param {number} depth
   * @param {number} height
   * @param {number} sideIndex
   * @param {number} baseY
   * @param {number} rowDetailFactor
   * @param {THREE.Material} buildingMaterial
   * @param {{minLines: number, maxLines: number}} wrappedLineSettings
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number} | undefined} walkwayClearanceZone
   * @returns {void}
   */
  _buildWrappedLineBuilding(
    chunkGroup,
    rng,
    posX,
    posZ,
    width,
    depth,
    height,
    sideIndex,
    baseY,
    rowDetailFactor,
    buildingMaterial,
    wrappedLineSettings,
    walkwayClearanceZone
  ) {
    const adjustedPosX = this._resolveSegmentXWithWalkwayClearance(
      posX,
      posZ,
      width,
      depth,
      baseY + height * 0.5,
      height,
      sideIndex,
      walkwayClearanceZone
    )
    const posY = baseY + height * 0.5
    const building = new THREE.Mesh(this.resources.geometries.building, buildingMaterial)
    building.scale.set(width, height, depth)
    building.position.set(adjustedPosX, posY, posZ)
    chunkGroup.add(building)

    this._addWrappedPerimeterLines(
      chunkGroup,
      rng,
      adjustedPosX,
      posY,
      posZ,
      width,
      height,
      depth,
      rowDetailFactor,
      wrappedLineSettings
    )
    this._addSignPanels(chunkGroup, rng, adjustedPosX, posY, posZ, width, height, depth, sideIndex, rowDetailFactor)
    this._addNeonStrips(chunkGroup, rng, adjustedPosX, posY, posZ, width, height, depth, sideIndex, rowDetailFactor)
  }

  /**
   * Push a segment away from the walkway clearance zone when needed.
   * @param {number} segmentPosX
   * @param {number} segmentPosZ
   * @param {number} segmentWidth
   * @param {number} segmentDepth
   * @param {number} segmentCenterY
   * @param {number} segmentHeight
   * @param {number} sideIndex
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number} | undefined} walkwayClearanceZone
   * @returns {number}
   */
  _resolveSegmentXWithWalkwayClearance(
    segmentPosX,
    segmentPosZ,
    segmentWidth,
    segmentDepth,
    segmentCenterY,
    segmentHeight,
    sideIndex,
    walkwayClearanceZone
  ) {
    if (!walkwayClearanceZone) {
      return segmentPosX
    }

    const segmentMinX = segmentPosX - segmentWidth * 0.5
    const segmentMaxX = segmentPosX + segmentWidth * 0.5
    const segmentMinY = segmentCenterY - segmentHeight * 0.5
    const segmentMaxY = segmentCenterY + segmentHeight * 0.5
    const segmentMinZ = segmentPosZ - segmentDepth * 0.5
    const segmentMaxZ = segmentPosZ + segmentDepth * 0.5
    const touchesClearanceZone = this._isSegmentBlockedByWalkwayClearance(
      segmentMinX,
      segmentMaxX,
      segmentMinY,
      segmentMaxY,
      segmentMinZ,
      segmentMaxZ,
      walkwayClearanceZone
    )

    if (!touchesClearanceZone) {
      return segmentPosX
    }

    return this._resolveSideAnchoredClearanceX(segmentPosX, segmentWidth, sideIndex, walkwayClearanceZone)
  }

  /**
   * Check if a segment overlaps the protected low-height walkway volume.
   * @param {number} segmentMinX
   * @param {number} segmentMaxX
   * @param {number} segmentMinY
   * @param {number} segmentMaxY
   * @param {number} segmentMinZ
   * @param {number} segmentMaxZ
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number}} walkwayClearanceZone
   * @returns {boolean}
   */
  _isSegmentBlockedByWalkwayClearance(segmentMinX, segmentMaxX, segmentMinY, segmentMaxY, segmentMinZ, segmentMaxZ, walkwayClearanceZone) {
    const overlapsY = this._rangesOverlap(segmentMinY, segmentMaxY, walkwayClearanceZone.yMin, walkwayClearanceZone.yMax)
    if (!overlapsY) {
      return false
    }

    const overlapsZ = this._rangesOverlap(segmentMinZ, segmentMaxZ, walkwayClearanceZone.zMin, walkwayClearanceZone.zMax)
    if (!overlapsZ) {
      return false
    }

    return this._rangesOverlap(segmentMinX, segmentMaxX, walkwayClearanceZone.xMin, walkwayClearanceZone.xMax)
  }

  /**
   * Resolve the nearest safe X center based on the building side.
   * @param {number} segmentPosX
   * @param {number} segmentWidth
   * @param {number} sideIndex
   * @param {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number}} walkwayClearanceZone
   * @returns {number}
   */
  _resolveSideAnchoredClearanceX(segmentPosX, segmentWidth, sideIndex, walkwayClearanceZone) {
    const clearancePadding = 0.05 + BuildingsGenerator.WALKWAY_FACADE_PROTRUSION_PADDING
    const halfWidth = segmentWidth * 0.5
    if (sideIndex < 0) {
      const maxAllowedCenterX = walkwayClearanceZone.xMin - halfWidth - clearancePadding
      return Math.min(segmentPosX, maxAllowedCenterX)
    }

    const minAllowedCenterX = walkwayClearanceZone.xMax + halfWidth + clearancePadding
    return Math.max(segmentPosX, minAllowedCenterX)
  }

  /**
   * Test overlap between two inclusive ranges.
   * @param {number} minA
   * @param {number} maxA
   * @param {number} minB
   * @param {number} maxB
   * @returns {boolean}
   */
  _rangesOverlap(minA, maxA, minB, maxB) {
    return maxA >= minB && minA <= maxB
  }

  /**
   * Pick one building material variant.
   * @param {() => number} rng
   * @param {{baseChanceRatio: number}} buildingColorSettings
   * @returns {THREE.Material}
   */
  _pickBuildingMaterial(rng, buildingColorSettings) {
    if (rng() < buildingColorSettings.baseChanceRatio) {
      return this.resources.palettes.building.base
    }

    const randomPalette = this.resources.palettes.building.random
    if (!Array.isArray(randomPalette) || randomPalette.length === 0) {
      return this.resources.palettes.building.base
    }

    const materialIndex = Math.floor(rng() * randomPalette.length)
    return randomPalette[materialIndex]
  }

  /**
   * Pick one window material for an entire building.
   * @param {() => number} rng
   * @returns {THREE.Material}
   */
  _pickWindowBuildingMaterial(rng) {
    const materialIndex = Math.floor(rng() * this.resources.palettes.windowBuildingMaterial.length)
    return this.resources.palettes.windowBuildingMaterial[materialIndex]
  }

  /**
   * Pick one neon material from the cyber palette.
   * @param {() => number} rng
   * @returns {THREE.Material}
   */
  _pickNeonMaterial(rng) {
    const materialIndex = Math.floor(rng() * this.resources.palettes.neon.length)
    return this.resources.palettes.neon[materialIndex]
  }

  /**
   * Add horizontal lines that wrap around the whole building perimeter.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posY
   * @param {number} posZ
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @returns {void}
   */
  _addWrappedPerimeterLines(chunkGroup, rng, posX, posY, posZ, width, height, depth, detailFactor = 1, wrappedLineSettings = null) {
    const minLines = wrappedLineSettings?.minLines ?? 12
    const maxLines = wrappedLineSettings?.maxLines ?? 28
    const lineBaseCount = minLines + Math.floor(rng() * (Math.max(minLines, maxLines) - minLines + 1))
    const lineCount = Math.max(1, Math.floor(lineBaseCount * (0.2 + detailFactor * 0.8)))
    const yMin = -height * 0.5 + 1
    const yMax = height * 0.5 - 1

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const y = yMin + ((yMax - yMin) * lineIndex) / Math.max(1, lineCount - 1)
      const thickness = 0.08 + rng() * 0.07
      const material = rng() > 0.88 ? this._pickNeonMaterial(rng) : this.resources.materials.neonSoft

      const front = new THREE.Mesh(this.resources.geometries.neonBand, material)
      front.scale.set(width + 0.28, thickness, 0.09)
      front.position.set(posX, posY + y, posZ + depth * 0.5 + 0.08)
      chunkGroup.add(front)

      const back = new THREE.Mesh(this.resources.geometries.neonBand, material)
      back.scale.set(width + 0.28, thickness, 0.09)
      back.position.set(posX, posY + y, posZ - depth * 0.5 - 0.08)
      chunkGroup.add(back)

      const left = new THREE.Mesh(this.resources.geometries.neonBand, material)
      left.scale.set(depth + 0.28, thickness, 0.09)
      left.rotation.y = Math.PI * 0.5
      left.position.set(posX - width * 0.5 - 0.08, posY + y, posZ)
      chunkGroup.add(left)

      const right = new THREE.Mesh(this.resources.geometries.neonBand, material)
      right.scale.set(depth + 0.28, thickness, 0.09)
      right.rotation.y = Math.PI * 0.5
      right.position.set(posX + width * 0.5 + 0.08, posY + y, posZ)
      chunkGroup.add(right)
    }
  }

  /**
   * Add emissive neon strips on building facades.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posY
   * @param {number} posZ
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @returns {void}
   */
  _addNeonStrips(chunkGroup, rng, posX, posY, posZ, width, height, depth, sideIndex, detailFactor = 1) {
    const stripBaseCount = 3 + Math.floor(rng() * 6)
    const stripCount = Math.max(1, Math.floor(stripBaseCount * (0.3 + detailFactor * 0.7)))
    for (let stripIndex = 0; stripIndex < stripCount; stripIndex += 1) {
      const strip = new THREE.Mesh(this.resources.geometries.neonStrip, this._pickNeonMaterial(rng))

      const stripHeight = 5 + rng() * Math.min(26, height * 0.55)
      strip.scale.y = stripHeight

      const localY = -height * 0.5 + stripHeight * 0.5 + rng() * (height * 0.84)
      const localZ = -depth * 0.5 + rng() * depth
      const localX = sideIndex < 0 ? width * 0.5 + 0.12 : -width * 0.5 - 0.12
      strip.position.set(posX + localX, posY + localY, posZ + localZ)
      chunkGroup.add(strip)
    }
  }

  /**
   * Add horizontal neon bands on building facades.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posY
   * @param {number} posZ
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @returns {void}
   */
  _addNeonBands(chunkGroup, rng, posX, posY, posZ, width, height, depth, sideIndex, detailFactor = 1) {
    const bandBaseCount = 1 + Math.floor(rng() * 2)
    const bandCount = Math.max(0, Math.floor(bandBaseCount * (0.2 + detailFactor * 0.8)))
    for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
      const band = new THREE.Mesh(this.resources.geometries.neonBand, this._pickNeonMaterial(rng))
      const bandDepth = depth * (0.45 + rng() * 0.4)
      const localY = -height * 0.5 + 2 + rng() * Math.max(2, height - 4)
      const localX = sideIndex < 0 ? width * 0.5 + 0.1 : -width * 0.5 - 0.1
      const localZ = -depth * 0.24 + rng() * (depth * 0.48)

      band.scale.set(0.12, 0.22, Math.max(1.6, bandDepth))
      band.position.set(posX + localX, posY + localY, posZ + localZ)
      chunkGroup.add(band)
    }
  }

  /**
   * Add emissive signage panels on facades.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posY
   * @param {number} posZ
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @returns {void}
   */
  _addSignPanels(chunkGroup, rng, posX, posY, posZ, width, height, depth, sideIndex, detailFactor = 1) {
    const signBaseCount = 2 + Math.floor(rng() * 2)
    const signCount = Math.max(1, Math.floor(signBaseCount * (0.25 + detailFactor * 0.75)))
    for (let signIndex = 0; signIndex < signCount; signIndex += 1) {
      const panel = new THREE.Mesh(this.resources.geometries.signPanel, this._pickNeonMaterial(rng))
      const panelWidth = 2.4 + rng() * 5.2
      const panelHeight = 1.1 + rng() * 2.7
      const panelDepth = 1 + rng() * 0.9
      const localX = sideIndex < 0 ? width * 0.5 + 0.34 : -width * 0.5 - 0.34
      const localY = -height * 0.5 + 4.2 + rng() * Math.max(1, height - 8.4)
      const localZ = -depth * 0.44 + rng() * (depth * 0.88)

      panel.scale.set(panelWidth, panelHeight, panelDepth)
      panel.position.set(posX + localX, posY + localY, posZ + localZ)
      chunkGroup.add(panel)
    }
  }

  /**
   * Add lit rectangular windows on building facades.
   * @param {THREE.Group} chunkGroup
   * @param {() => number} rng
   * @param {number} posX
   * @param {number} posY
   * @param {number} posZ
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @param {THREE.Material} windowMaterial
   * @returns {void}
   */
  _addWindowPanels(chunkGroup, rng, posX, posY, posZ, width, height, depth, sideIndex, windowMaterial, detailFactor = 1) {
    const frontInstances = this._collectFrontWindowInstances(rng, width, height, depth, sideIndex, detailFactor)
    const sideInstances = this._collectSideWindowInstances(rng, width, height, depth, sideIndex, detailFactor)

    if (frontInstances.length > 0) {
      const frontMesh = this._createWindowInstancedMesh(frontInstances.length, windowMaterial)
      this._writeWindowInstances(frontMesh, frontInstances, false)
      frontMesh.position.set(posX, posY, posZ)
      chunkGroup.add(frontMesh)
    }

    if (sideInstances.length > 0) {
      const sideMesh = this._createWindowInstancedMesh(sideInstances.length, windowMaterial)
      this._writeWindowInstances(sideMesh, sideInstances, true)
      sideMesh.position.set(posX, posY, posZ)
      chunkGroup.add(sideMesh)
    }
  }

  /**
   * Collect front facade window instances.
   * @param {() => number} rng
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @returns {Array<{x: number, y: number, z: number}>}
   */
  _collectFrontWindowInstances(rng, width, height, depth, sideIndex, detailFactor = 1) {
    const detail = THREE.MathUtils.clamp(detailFactor, 0.2, 1)
    const columns = Math.max(2, Math.floor((depth / 1.65) * (0.35 + detail * 0.65)))
    const rows = Math.max(3, Math.floor((height / 5.6) * (0.4 + detail * 0.6)))
    const horizontalPadding = 1.0
    const verticalPadding = 2.2
    const litChance = getRuntimeTuningNumber("buildings.windowFrontLitChance", 0.7) * (0.45 + detail * 0.55)
    const maxInstanceCount = Math.max(20, Math.floor(110 * (0.25 + detail * 0.75)))
    const instances = []
    const x = sideIndex < 0 ? width * 0.5 + 0.14 : -width * 0.5 - 0.14

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        if (instances.length >= maxInstanceCount) {
          break
        }
        const verticalRatio = rowIndex / Math.max(1, rows - 1)
        const verticalLodFactor = verticalRatio < 0.5 ? 0.58 : 1
        if (rng() > litChance * verticalLodFactor) {
          continue
        }

        const depthRange = Math.max(0.3, depth - horizontalPadding * 2)
        const z = -depth * 0.5 + horizontalPadding + (depthRange * columnIndex) / Math.max(1, columns - 1)
        const heightRange = Math.max(0.3, height - verticalPadding * 2)
        const y = -height * 0.5 + verticalPadding + (heightRange * rowIndex) / Math.max(1, rows - 1)
        instances.push({ x, y, z })
      }
    }

    return instances
  }

  /**
   * Collect side facade window instances.
   * @param {() => number} rng
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} sideIndex
   * @returns {Array<{x: number, y: number, z: number}>}
   */
  _collectSideWindowInstances(rng, width, height, depth, sideIndex, detailFactor = 1) {
    const detail = THREE.MathUtils.clamp(detailFactor, 0.2, 1)
    const columns = Math.max(2, Math.floor((width / 1.75) * (0.4 + detail * 0.6)))
    const rows = Math.max(3, Math.floor((height / 6.1) * (0.42 + detail * 0.58)))
    const horizontalPadding = 1.0
    const verticalPadding = 2.4
    const litChance = getRuntimeTuningNumber("buildings.windowSideLitChance", 0.44) * (0.45 + detail * 0.55)
    const maxInstanceCount = Math.max(14, Math.floor(70 * (0.2 + detail * 0.8)))
    const instances = []
    const z = sideIndex < 0 ? depth * 0.5 + 0.14 : -depth * 0.5 - 0.14

    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        if (instances.length >= maxInstanceCount) {
          break
        }
        const verticalRatio = rowIndex / Math.max(1, rows - 1)
        const verticalLodFactor = verticalRatio < 0.5 ? 0.62 : 1
        if (rng() > litChance * verticalLodFactor) {
          continue
        }

        const widthRange = Math.max(0.3, width - horizontalPadding * 2)
        const x = -width * 0.5 + horizontalPadding + (widthRange * columnIndex) / Math.max(1, columns - 1)
        const heightRange = Math.max(0.3, height - verticalPadding * 2)
        const y = -height * 0.5 + verticalPadding + (heightRange * rowIndex) / Math.max(1, rows - 1)
        instances.push({ x, y, z })
      }
    }

    return instances
  }

  /**
   * Create an instanced mesh for window panels.
   * @param {number} count
   * @param {THREE.Material} windowMaterial
   * @returns {THREE.InstancedMesh}
   */
  _createWindowInstancedMesh(count, windowMaterial) {
    const mesh = new THREE.InstancedMesh(this.resources.geometries.windowPanel, windowMaterial, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    return mesh
  }

  /**
   * Write panel transforms and colors into an instanced mesh.
   * @param {THREE.InstancedMesh} mesh
   * @param {Array<{x: number, y: number, z: number}>} instances
   * @param {boolean} rotateToSide
   * @returns {void}
   */
  _writeWindowInstances(mesh, instances, rotateToSide) {
    const dummy = new THREE.Object3D()

    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index]
      dummy.position.set(instance.x, instance.y, instance.z)
      dummy.rotation.set(0, rotateToSide ? Math.PI * 0.5 : 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Compute detail factor based on row index from walkway.
   * @param {number} rowIndex
   * @param {number} rows
   * @returns {number}
   */
  _computeRowDetailFactor(rowIndex, rows) {
    if (rows <= 1) {
      return 1
    }

    const normalizedRow = rowIndex / (rows - 1)
    return THREE.MathUtils.clamp(1 - normalizedRow * 0.78, 0.22, 1)
  }

  /**
   * Compute detail factor based on vertical segment position.
   * @param {number} segmentCenterY
   * @param {number} bottomY
   * @param {number} totalHeight
   * @returns {number}
   */
  _computeVerticalDetailFactor(segmentCenterY, bottomY, totalHeight) {
    const ratio = (segmentCenterY - bottomY) / Math.max(0.001, totalHeight)
    if (ratio >= 0.5) {
      return 1
    }

    return 0.6 + ratio * 0.8
  }
}
