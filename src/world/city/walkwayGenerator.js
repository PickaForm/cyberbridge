/**
 * Walkway generator for the procedural city chunk.
 *
 * Usage:
 * const generator = new WalkwayGenerator(resources)
 * generator.build(chunkGroup)
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

export class WalkwayGenerator {
  /**
   * @type {number}
   */
  static CLEARANCE_HEIGHT_METERS = 10

  /**
   * @type {number}
   */
  static CLEARANCE_SIDE_MARGIN_METERS = 0.8

  /**
   * @param {object} resources
   */
  constructor(resources) {
    this.resources = resources
  }

  /**
   * Build walkway geometry for one chunk.
   * @param {THREE.Group} chunkGroup
   * @returns {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number}}
   */
  build(chunkGroup) {
    const walkway = new THREE.Mesh(this.resources.geometries.walkway, this.resources.materials.walkway)
    walkway.position.set(0, 0, 0)
    chunkGroup.add(walkway)

    const halfWidth = gameConfig.world.walkwayWidth * 0.5

    const leftRail = new THREE.Mesh(this.resources.geometries.guardrail, this.resources.materials.guardrail)
    leftRail.position.set(-halfWidth + 0.2, 0.95, 0)
    chunkGroup.add(leftRail)

    const rightRail = new THREE.Mesh(this.resources.geometries.guardrail, this.resources.materials.guardrail)
    rightRail.position.set(halfWidth - 0.2, 0.95, 0)
    chunkGroup.add(rightRail)

    return this._createWalkwayClearanceZone()
  }

  /**
   * Create the low-height protected zone that must stay open for pedestrians.
   * @returns {{xMin: number, xMax: number, zMin: number, zMax: number, yMin: number, yMax: number}}
   * @private
   * @ignore
   */
  _createWalkwayClearanceZone() {
    const halfWidth = gameConfig.world.walkwayWidth * 0.5
    const chunkHalfLength = gameConfig.world.chunkLength * 0.5
    const walkwayTopY = gameConfig.world.walkwayHeight * 0.5
    const sideMargin = Math.max(
      0,
      getRuntimeTuningNumber("buildings.walkwayClearanceSideMargin", WalkwayGenerator.CLEARANCE_SIDE_MARGIN_METERS)
    )
    const clearanceHeight = Math.max(
      0,
      getRuntimeTuningNumber("buildings.walkwayClearanceHeight", WalkwayGenerator.CLEARANCE_HEIGHT_METERS)
    )

    return {
      xMin: -halfWidth - sideMargin,
      xMax: halfWidth + sideMargin,
      zMin: -chunkHalfLength,
      zMax: chunkHalfLength,
      yMin: walkwayTopY,
      yMax: walkwayTopY + clearanceHeight
    }
  }
}
