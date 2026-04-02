/**
 * Flying cars simulation over the walkway.
 *
 * Usage:
 * const flyingCars = new FlyingCarsSystem(scene)
 * flyingCars.update(delta, player.position)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"
import { FlyingCarsRenderer } from "./flyingCarsRenderer.js"

export class FlyingCarsSystem {
  /**
   * Minimum extra gap kept between two cars in the same lane.
   * @type {number}
   */
  static MIN_SPAWN_GAP = 1.1

  /**
   * Max random attempts to find one free spawn slot.
   * @type {number}
   */
  static SPAWN_SLOT_ATTEMPTS = 40

  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.cars = []
    this.lanes = this._buildVirtualLanes()
    this.flyingCarsRenderer = new FlyingCarsRenderer(scene, gameConfig.flyingCars.maxCars)

    this._spawnInitialCars()
  }

  /**
   * Update flying cars movement and render matrices.
   * @param {number} deltaTime
   * @param {THREE.Vector3} playerPosition
   * @returns {void}
   */
  update(deltaTime, playerPosition) {
    const cappedDeltaTime = Math.min(deltaTime, 0.1)
    for (const car of this.cars) {
      this._updateCar(car, cappedDeltaTime)
      this._recycleIfOutOfRange(car, playerPosition.z)
      this._syncCarTransform(car, playerPosition)
    }

    this.flyingCarsRenderer.commit()
  }

  /**
   * Release flying cars resources.
   * @returns {void}
   */
  dispose() {
    this.flyingCarsRenderer.dispose()
    this.cars.length = 0
    this.lanes.length = 0
  }

  /**
   * Spawn all initial cars.
   * @returns {void}
   * @private
   * @ignore
   */
  _spawnInitialCars() {
    const carCount = Math.max(1, Math.round(gameConfig.flyingCars.maxCars))
    const spawnDistance = Math.max(8, gameConfig.flyingCars.spawnDistance)

    for (let carIndex = 0; carIndex < carCount; carIndex += 1) {
      const lane = this._pickRandomLane()
      const appearance = this._createCarAppearance()
      appearance.direction = lane.direction
      const z = this._findSafeLaneSpawnZ(lane.index, appearance.lengthScale, -spawnDistance, spawnDistance)
      const car = this._createCar(carIndex, z, lane, appearance)
      this.cars.push(car)
      this.flyingCarsRenderer.setCarAppearance(car.instanceIndex, car.appearance)
      this.flyingCarsRenderer.setCarMatrix(car.instanceIndex, car.x, car.y, car.z, true)
    }

    this.flyingCarsRenderer.commit()
  }

  /**
   * Create one flying car.
   * @param {number} instanceIndex
   * @param {number} z
   * @param {{index: number, x: number, y: number, direction: number} | undefined} lane
   * @param {object | undefined} appearance
   * @returns {object}
   * @private
   * @ignore
   */
  _createCar(instanceIndex, z, lane = undefined, appearance = undefined) {
    const selectedLane = lane ?? this._pickRandomLane()
    const selectedAppearance = appearance ?? this._createCarAppearance()
    selectedAppearance.direction = selectedLane.direction
    return {
      instanceIndex,
      laneIndex: selectedLane.index,
      direction: selectedLane.direction,
      x: selectedLane.x,
      y: selectedLane.y,
      z,
      appearance: selectedAppearance
    }
  }

  /**
   * Build one random appearance profile.
   * @returns {object}
   * @private
   * @ignore
   */
  _createCarAppearance() {
    const palette = [
      0x57c9ff,
      0xff6a86,
      0x7ff279,
      0xffd36b,
      0xb486ff,
      0x80fff6
    ]

    const glowChance = THREE.MathUtils.clamp(gameConfig.flyingCars.glowChance, 0, 1)
    const nonGlowLuminosity = THREE.MathUtils.clamp(gameConfig.flyingCars.nonGlowLuminosity, 0.2, 2.5)
    const glowIntensity = THREE.MathUtils.clamp(gameConfig.flyingCars.glowIntensity, 0, 3)

    return {
      color: palette[Math.floor(Math.random() * palette.length)],
      isGlow: Math.random() < glowChance,
      nonGlowLuminosity,
      glowIntensity,
      lengthScale: 1.15 + Math.random() * 1.1,
      widthScale: 0.58 + Math.random() * 0.55,
      heightScale: 0.42 + Math.random() * 0.38,
      direction: 1,
      frontWidthRatio: this._pickFrontWidthRatio(),
      frontHeightRatio: this._pickFrontHeightRatio()
    }
  }

  /**
   * Pick front width ratio where front can be at minimum half rear width.
   * @returns {number}
   * @private
   * @ignore
   */
  _pickFrontWidthRatio() {
    const profiledChance = 0.72
    if (Math.random() > profiledChance) {
      return 1
    }

    return 0.5 + Math.random() * 0.5
  }

  /**
   * Pick front height ratio where front can collapse to a line.
   * @returns {number}
   * @private
   * @ignore
   */
  _pickFrontHeightRatio() {
    const profiledChance = 0.72
    if (Math.random() > profiledChance) {
      return 1
    }

    return Math.random()
  }

  /**
   * Update one car position.
   * @param {object} car
   * @param {number} deltaTime
   * @returns {void}
   * @private
   * @ignore
   */
  _updateCar(car, deltaTime) {
    const speed = Math.max(0, gameConfig.flyingCars.speed)
    car.z += car.direction * speed * deltaTime
  }

  /**
   * Recycle one car when it is outside spawn range.
   * @param {object} car
   * @param {number} playerZ
   * @returns {void}
   * @private
   * @ignore
   */
  _recycleIfOutOfRange(car, playerZ) {
    const spawnDistance = Math.max(8, gameConfig.flyingCars.spawnDistance)
    const dz = car.z - playerZ
    if (Math.abs(dz) < spawnDistance) {
      return
    }

    const directionShift = dz > 0 ? -1 : 1

    const lane = this._pickRandomLane()
    car.laneIndex = lane.index
    car.direction = lane.direction
    car.x = lane.x
    car.y = lane.y

    car.appearance = this._createCarAppearance()
    car.appearance.direction = car.direction
    car.z = this._findSafeLaneSpawnZ(
      car.laneIndex,
      car.appearance.lengthScale,
      playerZ + directionShift * Math.max(6, spawnDistance * 0.72),
      playerZ + directionShift * spawnDistance,
      car.instanceIndex
    )
    this.flyingCarsRenderer.setCarAppearance(car.instanceIndex, car.appearance)
  }

  /**
   * Find one free spawn Z in a lane while enforcing spacing constraints.
   * @param {number} laneIndex
   * @param {number} carLengthScale
   * @param {number} zRangeA
   * @param {number} zRangeB
   * @param {number | undefined} ignoredInstanceIndex
   * @returns {number}
   * @private
   * @ignore
   */
  _findSafeLaneSpawnZ(laneIndex, carLengthScale, zRangeA, zRangeB, ignoredInstanceIndex = undefined) {
    const minZ = Math.min(zRangeA, zRangeB)
    const maxZ = Math.max(zRangeA, zRangeB)

    for (let attemptIndex = 0; attemptIndex < FlyingCarsSystem.SPAWN_SLOT_ATTEMPTS; attemptIndex += 1) {
      const candidateZ = minZ + Math.random() * (maxZ - minZ)
      if (this._isLaneSpawnSlotFree(laneIndex, candidateZ, carLengthScale, ignoredInstanceIndex)) {
        return candidateZ
      }
    }

    const overflowStep = this._computeSpawnSpacing(carLengthScale, carLengthScale)
    const centerZ = (minZ + maxZ) * 0.5
    for (let overflowIndex = 0; overflowIndex < 30; overflowIndex += 1) {
      const direction = overflowIndex % 2 === 0 ? 1 : -1
      const ring = Math.floor(overflowIndex * 0.5) + 1
      const candidateZ = centerZ + direction * ring * overflowStep
      if (this._isLaneSpawnSlotFree(laneIndex, candidateZ, carLengthScale, ignoredInstanceIndex)) {
        return candidateZ
      }
    }

    return centerZ
  }

  /**
   * Check if one spawn slot is free against existing cars in the same lane.
   * @param {number} laneIndex
   * @param {number} candidateZ
   * @param {number} candidateLengthScale
   * @param {number | undefined} ignoredInstanceIndex
   * @returns {boolean}
   * @private
   * @ignore
   */
  _isLaneSpawnSlotFree(laneIndex, candidateZ, candidateLengthScale, ignoredInstanceIndex = undefined) {
    for (const otherCar of this.cars) {
      if (otherCar.laneIndex !== laneIndex) {
        continue
      }

      if (ignoredInstanceIndex !== undefined && otherCar.instanceIndex === ignoredInstanceIndex) {
        continue
      }

      const otherLengthScale = otherCar.appearance?.lengthScale ?? 1.35
      const minSpacing = this._computeSpawnSpacing(candidateLengthScale, otherLengthScale)
      if (Math.abs(otherCar.z - candidateZ) < minSpacing) {
        return false
      }
    }

    return true
  }

  /**
   * Compute required spacing between two cars in the same lane.
   * @param {number} lengthScaleA
   * @param {number} lengthScaleB
   * @returns {number}
   * @private
   * @ignore
   */
  _computeSpawnSpacing(lengthScaleA, lengthScaleB) {
    return lengthScaleA * 0.5 + lengthScaleB * 0.5 + FlyingCarsSystem.MIN_SPAWN_GAP
  }

  /**
   * Sync one car transform into the renderer.
   * @param {object} car
   * @param {THREE.Vector3} playerPosition
   * @returns {void}
   * @private
   * @ignore
   */
  _syncCarTransform(car, playerPosition) {
    const clipDistance = Math.max(0, gameConfig.flyingCars.renderClipDistance)
    const distanceToPlayer = Math.abs(car.z - playerPosition.z) + Math.abs(car.x - playerPosition.x) * 0.22
    const shouldRender = distanceToPlayer <= clipDistance
    car.appearance.direction = car.direction
    this.flyingCarsRenderer.setCarMatrix(car.instanceIndex, car.x, car.y, car.z, shouldRender)
  }

  /**
   * Build virtual lanes for each level and direction.
   * @returns {object[]}
   * @private
   * @ignore
   */
  _buildVirtualLanes() {
    const laneCountPerDirection = THREE.MathUtils.clamp(Math.round(gameConfig.flyingCars.lanesPerDirection), 1, 4)
    const levelsCount = Math.max(1, Math.round(gameConfig.flyingCars.levelsCount))
    const laneSpacing = Math.max(0.9, gameConfig.flyingCars.laneSpacing)
    const firstLevelHeight = Math.max(0.5, gameConfig.flyingCars.firstLevelHeight)
    const levelSpacing = Math.max(0.5, gameConfig.flyingCars.levelSpacing)
    const totalLanes = laneCountPerDirection * 2
    const centerOffset = ((totalLanes - 1) * laneSpacing) * 0.5
    const lanes = []

    for (let levelIndex = 0; levelIndex < levelsCount; levelIndex += 1) {
      const laneY = gameConfig.world.walkwayHeight + firstLevelHeight + levelIndex * levelSpacing

      for (let laneIndex = 0; laneIndex < totalLanes; laneIndex += 1) {
        const laneX = laneIndex * laneSpacing - centerOffset
        const direction = laneIndex < laneCountPerDirection ? 1 : -1
        lanes.push({
          index: lanes.length,
          x: laneX,
          y: laneY,
          direction
        })
      }
    }

    if (lanes.length === 0) {
      lanes.push({
        index: 0,
        x: 0,
        y: gameConfig.world.walkwayHeight + 8,
        direction: 1
      })
    }

    return lanes
  }

  /**
   * Pick one random virtual lane.
   * @returns {object}
   * @private
   * @ignore
   */
  _pickRandomLane() {
    const randomIndex = Math.floor(Math.random() * this.lanes.length)
    return this.lanes[randomIndex]
  }
}
