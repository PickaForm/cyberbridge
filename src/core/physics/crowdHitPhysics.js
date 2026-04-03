import * as THREE from "three"

/**
 * NPC hit ballistic physics helpers.
 *
 * Usage:
 * import { CrowdHitPhysics } from "./core/physics/crowdHitPhysics.js"
 * const hitState = CrowdHitPhysics.createHitState(agent, player, gameConfig)
 * const isOut = CrowdHitPhysics.updateHitState(hitState, delta)
 */
const BASE_GRAVITY = 28
const MIN_ARC_HEIGHT = 0.1
const MIN_ARC_WIDTH = 0.2
const MIN_INITIAL_SPEED = 0.1
const MAX_LAUNCH_ANGLE_DEG = 85

export class CrowdHitPhysics {
  /**
   * Build a ballistic launch state for one NPC hit.
   * @param {object} options
   * @param {number} options.startX
   * @param {number} options.startY
   * @param {number} options.startZ
   * @param {number} options.walkwayWidth
   * @param {number} options.walkwayTopY
   * @param {number} options.playerFacingZ
   * @param {number} options.playerVelocityZ
   * @param {object} options.hitConfig
   * @returns {object}
   */
  static createHitState(options) {
    const {
      startX,
      startY,
      startZ,
      walkwayWidth,
      walkwayTopY,
      playerFacingZ,
      playerVelocityZ,
      hitConfig
    } = options

    const arcHeight = Math.max(MIN_ARC_HEIGHT, Number(hitConfig.arcHeight) || 0)
    const configuredArcWidth = Number(hitConfig.arcWidth) || 0
    const arcWidth = Math.max(MIN_ARC_WIDTH, configuredArcWidth > 0 ? configuredArcWidth : walkwayWidth)
    const initialSpeedTarget = Math.max(MIN_INITIAL_SPEED, Number(hitConfig.initialSpeed) || 0)
    const fallDepth = Math.max(0.2, Number(hitConfig.fallDepth) || 0)
    const launchAngleDeg = _clampLaunchAngleDeg(Number(hitConfig.launchAngleDeg) || 0)
    const forwardDiagonalFactor = Math.tan(THREE.MathUtils.degToRad(launchAngleDeg))

    const baseVerticalSpeed = Math.sqrt(2 * BASE_GRAVITY * arcHeight)
    const baseBridgeCrossTime = (baseVerticalSpeed * 2) / BASE_GRAVITY
    const basePlanarSpeed = arcWidth / Math.max(0.001, baseBridgeCrossTime)
    const baseInitialSpeed = Math.sqrt(baseVerticalSpeed * baseVerticalSpeed + basePlanarSpeed * basePlanarSpeed)
    const impulseScale = initialSpeedTarget / Math.max(0.001, baseInitialSpeed)
    const gravity = BASE_GRAVITY * impulseScale * impulseScale
    const verticalSpeed = baseVerticalSpeed * impulseScale
    const planarSpeed = basePlanarSpeed * impulseScale

    const lateralSign = Math.random() < 0.5 ? -1 : 1
    const forwardSign = _resolveForwardSign(playerFacingZ, playerVelocityZ)
    const planarLength = Math.sqrt(1 + forwardDiagonalFactor * forwardDiagonalFactor)
    const directionX = lateralSign / planarLength
    const directionZ = (forwardSign * forwardDiagonalFactor) / planarLength

    return {
      x: startX,
      y: startY,
      z: startZ,
      velocityX: directionX * planarSpeed,
      velocityY: verticalSpeed,
      velocityZ: directionZ * planarSpeed,
      gravity,
      destroyY: walkwayTopY - fallDepth
    }
  }

  /**
   * Advance one ballistic state by delta time.
   * @param {object} hitState
   * @param {number} deltaTime
   * @returns {boolean}
   */
  static updateHitState(hitState, deltaTime) {
    const stepDelta = Math.max(0, deltaTime)
    hitState.velocityY -= hitState.gravity * stepDelta
    hitState.x += hitState.velocityX * stepDelta
    hitState.y += hitState.velocityY * stepDelta
    hitState.z += hitState.velocityZ * stepDelta
    return hitState.y <= hitState.destroyY
  }
}

/**
 * Resolve forward launch sign from player movement.
 * @param {number} playerFacingZ
 * @param {number} playerVelocityZ
 * @returns {number}
 * @private
 * @ignore
 */
function _resolveForwardSign(playerFacingZ, playerVelocityZ) {
  const facingSign = Math.sign(playerFacingZ)
  if (facingSign !== 0) {
    return facingSign
  }

  const velocitySign = Math.sign(playerVelocityZ)
  if (velocitySign !== 0) {
    return velocitySign
  }

  return Math.random() < 0.5 ? -1 : 1
}

/**
 * Clamp launch angle in degrees.
 * @param {number} launchAngleDeg
 * @returns {number}
 * @private
 * @ignore
 */
function _clampLaunchAngleDeg(launchAngleDeg) {
  return THREE.MathUtils.clamp(launchAngleDeg, 0, MAX_LAUNCH_ANGLE_DEG)
}
