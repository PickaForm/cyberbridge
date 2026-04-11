/**
 * Crowd simulation for the bridge flow.
 *
 * Usage:
 * const crowd = new CrowdSystem(scene)
 * crowd.update(delta, player.position)
 */
import * as THREE from "three"
import { gameConfig } from "../config/gameConfig.js"
import { CrowdRenderer } from "./crowdRenderer.js"
import { CrowdHitPhysics } from "../core/physics/crowdHitPhysics.js"

export class CrowdSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {((payload: object) => void) | null} options.onNpcHit
   */
  constructor(scene, options = {}) {
    const { onNpcHit = null } = options
    this.agents = []
    this.laneMap = new Map()
    this.nextAgentId = 1
    this.stoppedAgentId = null
    const laneLayout = this._resolveLaneLayout()
    this.laneCount = laneLayout.laneCount
    this.laneSpacing = laneLayout.laneSpacing
    this.laneCenterOffset = laneLayout.centerOffset
    this.npcLaneMin = this.laneCount > 2 ? 1 : 0
    this.npcLaneMax = this.laneCount > 2 ? this.laneCount - 2 : this.laneCount - 1
    this.crowdRenderer = new CrowdRenderer(scene, gameConfig.crowd.maxAgents)
    this.simulationStep = 1 / gameConfig.crowd.simulationHz
    this.simulationAccumulator = 0
    this.maxSimulationStepsPerFrame = gameConfig.crowd.maxSimulationStepsPerFrame
    this.simulationTime = 0
    this.lastPlayerZ = null
    this.faceDetailDistance = 72
    this.faceDetailDistanceFar = 86
    this.nearSimulationDistance = 52
    this.midSimulationDistance = 118
    this.isProximityMoodTriggerEnabled = false
    this.faceToFaceBoxHalfWidth = this.laneSpacing * 0.6
    this.faceToFaceBoxHalfDepth = 3.4
    this.walkwayTopY = 1.05
    this.npcCollisionRadius = 0.62
    this.lastPlayerX = null
    this.lastPlayerY = null
    this.onNpcHit = typeof onNpcHit === "function" ? onNpcHit : null

    this._spawnInitialAgents()
  }

  /**
   * Resolve crowd lane layout from runtime tuning.
   * @returns {{laneCount: number, laneSpacing: number, centerOffset: number}}
   */
  _resolveLaneLayout() {
    const spawnLanesPerDirection = THREE.MathUtils.clamp(Math.round(gameConfig.crowd.spawnLanesPerDirection), 1, 8)
    const laneCount = Math.max(2, spawnLanesPerDirection * 2)
    const maxLaneSpacing = gameConfig.world.walkwayWidth / laneCount
    const requestedLaneSpacing = Math.max(0.2, gameConfig.crowd.laneSpacing)
    const laneSpacing = THREE.MathUtils.clamp(requestedLaneSpacing, 0.2, maxLaneSpacing)
    const centerOffset = ((laneCount - 1) * laneSpacing) * 0.5

    return {
      laneCount,
      laneSpacing,
      centerOffset
    }
  }

  /**
   * Update crowd movement and local avoidance.
   * @param {number} deltaTime
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerFacingZ
   * @returns {void}
   */
  update(deltaTime, playerPosition, playerFacingZ = 0) {
    const cappedDeltaTime = Math.min(deltaTime, 0.1)
    const playerVelocityZ = this._computePlayerVelocityZ(playerPosition.z, cappedDeltaTime)
    const playerStartX = this.lastPlayerX ?? playerPosition.x
    const playerStartY = this.lastPlayerY ?? playerPosition.y
    const playerStartZ = this.lastPlayerZ ?? playerPosition.z
    this.simulationAccumulator += cappedDeltaTime
    let simulationStepCount = 0

    while (this.simulationAccumulator >= this.simulationStep && simulationStepCount < this.maxSimulationStepsPerFrame) {
      this._simulateStep(this.simulationStep, playerPosition, playerVelocityZ, playerFacingZ)
      this.simulationAccumulator -= this.simulationStep
      simulationStepCount += 1
    }

    if (simulationStepCount === this.maxSimulationStepsPerFrame && this.simulationAccumulator > this.simulationStep) {
      this.simulationAccumulator = this.simulationStep
    }

    this._resolvePlayerNpcHitCollisionsFromSweep(
      playerStartX,
      playerStartY,
      playerStartZ,
      playerPosition.x,
      playerPosition.y,
      playerPosition.z,
      playerVelocityZ,
      playerFacingZ
    )

    const interpolationAlpha = this.simulationAccumulator / this.simulationStep
    this._renderInterpolated(interpolationAlpha, playerPosition)
    this.crowdRenderer.commit()
    this.lastPlayerX = playerPosition.x
    this.lastPlayerY = playerPosition.y
    this.lastPlayerZ = playerPosition.z
  }

  /**
   * Release crowd resources.
   * @returns {void}
   */
  dispose() {
    this.crowdRenderer.dispose()
    this.agents.length = 0
    this.laneMap.clear()
    this.stoppedAgentId = null
    this.lastPlayerX = null
    this.lastPlayerY = null
    this.lastPlayerZ = null
  }

  /**
   * Get interactive crowd meshes used for raycasting.
   * @returns {THREE.Object3D[]}
   */
  getInteractiveMeshes() {
    return [this.crowdRenderer.instanceMesh]
  }

  /**
   * Toggle interaction stop state for one NPC by instance id.
   * @param {number} instanceIndex
   * @returns {void}
   */
  toggleNpcInteractionStopByInstanceIndex(instanceIndex) {
    const selectedAgent = this._getAgentByInstanceIndex(instanceIndex)
    if (!selectedAgent || selectedAgent.isHitActive) {
      return
    }

    if (this.stoppedAgentId === selectedAgent.id) {
      selectedAgent.isInteractionStopped = false
      this.stoppedAgentId = null
      return
    }

    // Ensure only one NPC stays stopped at a time.
    if (this.stoppedAgentId !== null) {
      const previousAgent = this._getAgentById(this.stoppedAgentId)
      if (previousAgent) {
        previousAgent.isInteractionStopped = false
      }
    }

    selectedAgent.isInteractionStopped = true
    selectedAgent.currentSpeed = 0
    this.stoppedAgentId = selectedAgent.id
  }

  /**
   * Spawn initial crowd near origin.
   * @returns {void}
   */
  _spawnInitialAgents() {
    for (let agentIndex = 0; agentIndex < gameConfig.crowd.maxAgents; agentIndex += 1) {
      const laneIndex = this._randomNpcLaneIndex()
      const direction = Math.random() > 0.5 ? 1 : -1
      const baseSpeed = this._getRandomBaseSpeed()
      const z = this._resolveInitialSpawnZWithSpacing(laneIndex)
      const agent = this._createAgent(laneIndex, direction, baseSpeed, z, agentIndex)
      this.agents.push(agent)
      this._syncAgentBodyColor(agent)
      this._syncAgentAppearance(agent)
      this._syncAgentTransform(agent, agent.x, agent.y, agent.z)
    }

    this.crowdRenderer.commit()
  }

  /**
   * Create one crowd agent.
   * @param {number} laneIndex
   * @param {number} direction
   * @param {number} baseSpeed
   * @param {number} z
   * @param {number} instanceIndex
   * @returns {object}
   */
  _createAgent(laneIndex, direction, baseSpeed, z, instanceIndex) {
    const id = this.nextAgentId
    this.nextAgentId += 1
    const x = this._laneToX(laneIndex)
    const speedProfile = this._createSpeedProfile(baseSpeed)
    const faceProfile = this._createFaceProfile()

    return {
      id,
      instanceIndex,
      isInteractionStopped: false,
      isHitActive: false,
      hitState: null,
      baseMood: faceProfile.mood,
      laneIndex,
      laneChangeCooldown: Math.random() * 0.3,
      direction,
      baseSpeed,
      currentSpeed: baseSpeed,
      speedVariationAmplitude: speedProfile.speedVariationAmplitude,
      speedVariationFrequency: speedProfile.speedVariationFrequency,
      speedVariationPhase: speedProfile.speedVariationPhase,
      mood: faceProfile.mood,
      eyeShape: faceProfile.eyeShape,
      eyeScale: faceProfile.eyeScale,
      eyeSpacing: faceProfile.eyeSpacing,
      eyeYOffset: faceProfile.eyeYOffset,
      mouthScale: faceProfile.mouthScale,
      mouthYOffset: faceProfile.mouthYOffset,
      mouthArcDepth: faceProfile.mouthArcDepth,
      mouthTilt: faceProfile.mouthTilt,
      eyeColor: faceProfile.eyeColor,
      bodyVariant: this._pickBodyColorVariant(),
      faceLodVisible: true,
      lodSimulationAccumulator: 0,
      z,
      y: this.walkwayTopY,
      x,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      previousRotationX: 0,
      previousRotationY: 0,
      previousRotationZ: 0,
      hitSpinVelocityY: 0,
      previousX: x,
      previousY: this.walkwayTopY,
      previousZ: z
    }
  }

  /**
   * Run one fixed simulation step.
   * @param {number} simulationDelta
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {void}
   */
  _simulateStep(simulationDelta, playerPosition, playerVelocityZ, playerFacingZ) {
    this.simulationTime += simulationDelta
    this._rebuildLaneMap()

    for (const agent of this.agents) {
      agent.previousX = agent.x
      agent.previousY = agent.y
      agent.previousZ = agent.z
      agent.previousRotationX = agent.rotationX
      agent.previousRotationY = agent.rotationY
      agent.previousRotationZ = agent.rotationZ
    }

    for (const agent of this.agents) {
      if (agent.isHitActive) {
        this._updateHitAgent(agent, simulationDelta, playerPosition.z)
        continue
      }

      const lodSimulationDelta = this._consumeAgentSimulationDelta(agent, simulationDelta, playerPosition)
      if (lodSimulationDelta <= 0) {
        continue
      }

      this._updateAgent(agent, lodSimulationDelta, playerPosition, playerVelocityZ, playerFacingZ)
      this._recycleIfOutOfRange(agent, playerPosition.z)
    }

  }

  /**
   * Render an interpolated crowd frame.
   * @param {number} interpolationAlpha
   * @param {THREE.Vector3} playerPosition
   * @returns {void}
   */
  _renderInterpolated(interpolationAlpha, playerPosition) {
    const alpha = THREE.MathUtils.clamp(interpolationAlpha, 0, 1)
    for (const agent of this.agents) {
      const renderX = THREE.MathUtils.lerp(agent.previousX, agent.x, alpha)
      const renderY = THREE.MathUtils.lerp(agent.previousY, agent.y, alpha)
      const renderZ = THREE.MathUtils.lerp(agent.previousZ, agent.z, alpha)
      const renderRotationX = THREE.MathUtils.lerp(agent.previousRotationX, agent.rotationX, alpha)
      const renderRotationY = THREE.MathUtils.lerp(agent.previousRotationY, agent.rotationY, alpha)
      const renderRotationZ = THREE.MathUtils.lerp(agent.previousRotationZ, agent.rotationZ, alpha)
      this._syncAgentTransform(agent, renderX, renderY, renderZ, renderRotationX, renderRotationY, renderRotationZ, playerPosition)
    }
  }

  /**
   * Recompute lane buckets for local neighborhood checks.
   * @returns {void}
   */
  _rebuildLaneMap() {
    this.laneMap.clear()

    for (let laneIndex = 0; laneIndex < this.laneCount; laneIndex += 1) {
      this.laneMap.set(laneIndex, [])
    }

    for (const agent of this.agents) {
      if (agent.isHitActive) {
        continue
      }
      this.laneMap.get(agent.laneIndex).push(agent)
    }

    for (const laneAgents of this.laneMap.values()) {
      laneAgents.sort((left, right) => left.z - right.z)
    }
  }

  /**
   * Update one agent and avoid nearest threats.
   * @param {object} agent
   * @param {number} simulationDelta
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {void}
   */
  _updateAgent(agent, simulationDelta, playerPosition, playerVelocityZ, playerFacingZ) {
    if (agent.isHitActive) {
      return
    }

    if (this.isProximityMoodTriggerEnabled) {
      this._updateAgentMoodFromPlayerProximity(agent, playerPosition, playerVelocityZ, playerFacingZ)
    }

    if (agent.isInteractionStopped) {
      agent.currentSpeed = 0
      return
    }

    if (agent.laneChangeCooldown > 0) {
      agent.laneChangeCooldown -= simulationDelta
    }

    const nearestThreat = this._findNearestThreat(agent, playerPosition, playerVelocityZ)
    const safeDistance = this._getReactionDistance(nearestThreat)
    const desiredSpeed = this._computeAgentDesiredSpeed(agent)
    const speedLerpAlpha = Math.min(1, simulationDelta * 2.6)
    agent.currentSpeed = THREE.MathUtils.lerp(agent.currentSpeed, desiredSpeed, speedLerpAlpha)
    let speedScale = 1

    if (nearestThreat.isRear && nearestThreat.distance < safeDistance) {
      speedScale = 0.95
      this._tryLaneChange(agent, nearestThreat)
    } else if (nearestThreat.distance < safeDistance * 0.75) {
      speedScale = nearestThreat.isFrontal ? 0.05 : 0.12
      this._tryLaneChange(agent, nearestThreat)
    } else if (nearestThreat.distance < safeDistance * 1.5) {
      speedScale = nearestThreat.isFrontal ? 0.22 : 0.45
      this._tryLaneChange(agent, nearestThreat)
    }

    const currentX = agent.x
    const targetX = this._laneToX(agent.laneIndex)
    agent.x = THREE.MathUtils.lerp(currentX, targetX, Math.min(1, simulationDelta * 7))

    const proposedZ = agent.z + agent.direction * agent.currentSpeed * speedScale * simulationDelta
    agent.z = this._limitForwardMotion(agent, proposedZ)
  }

  /**
   * Update one launched NPC with ballistic motion.
   * @param {object} agent
   * @param {number} simulationDelta
   * @param {number} playerZ
   * @returns {void}
   */
  _updateHitAgent(agent, simulationDelta, playerZ) {
    if (!agent.hitState) {
      agent.isHitActive = false
      agent.y = this.walkwayTopY
      return
    }

    const shouldDestroyAgent = CrowdHitPhysics.updateHitState(agent.hitState, simulationDelta)
    agent.x = agent.hitState.x
    agent.y = agent.hitState.y
    agent.z = agent.hitState.z
    agent.rotationY += agent.hitSpinVelocityY * simulationDelta
    if (!shouldDestroyAgent) {
      return
    }

    this._resetAgentAfterHit(agent, playerZ)
  }

  /**
   * Resolve collisions between player and NPCs to trigger hit launches.
   * @param {number} playerStartX
   * @param {number} playerStartY
   * @param {number} playerStartZ
   * @param {number} playerEndX
   * @param {number} playerEndY
   * @param {number} playerEndZ
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {void}
   */
  _resolvePlayerNpcHitCollisionsFromSweep(
    playerStartX,
    playerStartY,
    playerStartZ,
    playerEndX,
    playerEndY,
    playerEndZ,
    playerVelocityZ,
    playerFacingZ
  ) {
    for (const agent of this.agents) {
      if (!this._canAgentBeHit(agent)) {
        continue
      }

      if (!this._isPlayerPathCollidingWithAgent(playerStartX, playerStartY, playerStartZ, playerEndX, playerEndY, playerEndZ, agent.x, agent.y, agent.z)) {
        continue
      }

      this._launchHitAgent(agent, playerVelocityZ, playerFacingZ)
    }
  }

  /**
   * Check if one NPC can be launched by player collision.
   * @param {object} agent
   * @returns {boolean}
   */
  _canAgentBeHit(agent) {
    return !agent.isHitActive
  }

  /**
   * Test 3D collision between one swept player segment and one NPC sphere.
   * @param {number} playerStartX
   * @param {number} playerStartY
   * @param {number} playerStartZ
   * @param {number} playerEndX
   * @param {number} playerEndY
   * @param {number} playerEndZ
   * @param {number} agentX
   * @param {number} agentY
   * @param {number} agentZ
   * @returns {boolean}
   */
  _isPlayerPathCollidingWithAgent(playerStartX, playerStartY, playerStartZ, playerEndX, playerEndY, playerEndZ, agentX, agentY, agentZ) {
    const segmentX = playerEndX - playerStartX
    const segmentY = playerEndY - playerStartY
    const segmentZ = playerEndZ - playerStartZ
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ
    if (segmentLengthSquared <= 0.000001) {
      return this._isPointWithinHitRadius(playerEndX, playerEndY, playerEndZ, agentX, agentY, agentZ)
    }

    const toAgentX = agentX - playerStartX
    const toAgentY = agentY - playerStartY
    const toAgentZ = agentZ - playerStartZ
    const projection = (toAgentX * segmentX + toAgentY * segmentY + toAgentZ * segmentZ) / segmentLengthSquared
    const clampedProjection = THREE.MathUtils.clamp(projection, 0, 1)
    const closestX = playerStartX + segmentX * clampedProjection
    const closestY = playerStartY + segmentY * clampedProjection
    const closestZ = playerStartZ + segmentZ * clampedProjection
    return this._isPointWithinHitRadius(closestX, closestY, closestZ, agentX, agentY, agentZ)
  }

  /**
   * Check if one point is inside the player/NPC collision radius.
   * @param {number} pointX
   * @param {number} pointY
   * @param {number} pointZ
   * @param {number} agentX
   * @param {number} agentY
   * @param {number} agentZ
   * @returns {boolean}
   */
  _isPointWithinHitRadius(pointX, pointY, pointZ, agentX, agentY, agentZ) {
    const dx = pointX - agentX
    const dy = pointY - agentY
    const dz = pointZ - agentZ
    const playerCollisionRadius = Math.max(0, gameConfig.player.collisionRadius)
    const combinedCollisionRadius = playerCollisionRadius + this.npcCollisionRadius
    const radiusSquared = combinedCollisionRadius * combinedCollisionRadius
    return dx * dx + dy * dy + dz * dz <= radiusSquared
  }

  /**
   * Start one hit launch for the target agent.
   * @param {object} agent
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {void}
   */
  _launchHitAgent(agent, playerVelocityZ, playerFacingZ) {
    if (agent.isHitActive) {
      return
    }

    if (this.stoppedAgentId === agent.id) {
      this.stoppedAgentId = null
    }

    agent.isInteractionStopped = false
    agent.isHitActive = true
    agent.currentSpeed = 0
    agent.hitState = CrowdHitPhysics.createHitState({
      startX: agent.x,
      startY: this.walkwayTopY,
      startZ: agent.z,
      walkwayWidth: gameConfig.world.walkwayWidth,
      walkwayTopY: this.walkwayTopY,
      playerFacingZ,
      playerVelocityZ,
      hitConfig: gameConfig.hit
    })
    agent.y = agent.hitState.y
    agent.hitSpinVelocityY = this._getHitSpinVelocityY()
    this.onNpcHit?.({
      id: agent.id,
      bodyVariant: agent.bodyVariant,
      x: agent.x,
      y: agent.y,
      z: agent.z
    })
  }

  /**
   * Find nearest potential collision and classify the threat.
   * @param {object} agent
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerVelocityZ
   * @returns {object}
   */
  _findNearestThreat(agent, playerPosition, playerVelocityZ) {
    const laneAgents = this.laneMap.get(agent.laneIndex)
    const bestThreat = {
      type: "none",
      distance: 999,
      isFrontal: false,
      isRear: false
    }

    for (const neighbor of laneAgents) {
      if (neighbor === agent) {
        continue
      }

      const dz = neighbor.z - agent.z
      const isAhead = agent.direction > 0 ? dz > 0 : dz < 0
      if (!isAhead) {
        continue
      }

      const distance = Math.abs(dz)
      if (distance < bestThreat.distance) {
        bestThreat.type = "agent"
        bestThreat.distance = distance
        bestThreat.isFrontal = neighbor.direction !== agent.direction
        bestThreat.isRear = false
      }
    }

    const playerLane = this._xToLane(playerPosition.x)
    if (playerLane === agent.laneIndex) {
      const playerDz = playerPosition.z - agent.z
      const playerAhead = agent.direction > 0 ? playerDz > 0 : playerDz < 0
      const distance = Math.abs(playerDz)
      if (playerAhead && distance < bestThreat.distance) {
        bestThreat.type = "player"
        bestThreat.distance = distance
        bestThreat.isFrontal = false
        bestThreat.isRear = false
      } else if (!playerAhead && this._isRearYieldThreat(agent, playerVelocityZ, distance)) {
        const rearPriorityDistance = distance * 1.45
        if (rearPriorityDistance < bestThreat.distance) {
          bestThreat.type = "player"
          bestThreat.distance = distance
          bestThreat.isFrontal = false
          bestThreat.isRear = true
        }
      }
    }

    return bestThreat
  }

  /**
   * Try to move the agent to an adjacent lane.
   * @param {object} agent
   * @param {object} threat
   * @returns {void}
   */
  _tryLaneChange(agent, threat) {
    if (agent.laneChangeCooldown > 0) {
      return
    }

    const candidates = this._getAdjacentLanes(agent)
    if (candidates.length === 0) {
      return
    }

    // Head-on conflicts use a side rule to avoid symmetric deadlocks.
    if (threat.type === "agent" && threat.isFrontal) {
      const preferredLane = this._getPreferredFrontalLane(agent)
      if (candidates.includes(preferredLane) && this._isLaneAvailable(agent, preferredLane)) {
        agent.laneIndex = preferredLane
        agent.laneChangeCooldown = gameConfig.crowd.laneChangeCooldown * 0.75
        return
      }
    }

    let selectedLane = agent.laneIndex
    let bestScore = Number.MAX_SAFE_INTEGER

    for (const laneIndex of candidates) {
      if (!this._isLaneAvailable(agent, laneIndex)) {
        continue
      }

      const score = this._laneRiskScore(agent, laneIndex, threat)
      if (score < bestScore) {
        bestScore = score
        selectedLane = laneIndex
      }
    }

    if (selectedLane !== agent.laneIndex) {
      agent.laneIndex = selectedLane
      agent.laneChangeCooldown = gameConfig.crowd.laneChangeCooldown
    }
  }

  /**
   * Get valid adjacent lane indices.
   * @param {object} agent
   * @returns {number[]}
   */
  _getAdjacentLanes(agent) {
    const leftLane = agent.laneIndex - 1
    const rightLane = agent.laneIndex + 1
    const candidates = []

    if (this._isNpcLaneAllowed(leftLane)) {
      candidates.push(leftLane)
    }
    if (this._isNpcLaneAllowed(rightLane)) {
      candidates.push(rightLane)
    }

    return candidates
  }

  /**
   * Choose preferred bypass lane for frontal conflict.
   * @param {object} agent
   * @returns {number}
   */
  _getPreferredFrontalLane(agent) {
    const laneDelta = agent.direction > 0 ? 1 : -1
    const laneIndex = agent.laneIndex + laneDelta
    return THREE.MathUtils.clamp(laneIndex, this.npcLaneMin, this.npcLaneMax)
  }

  /**
   * Check if a lane can be entered now.
   * @param {object} agent
   * @param {number} laneIndex
   * @returns {boolean}
   */
  _isLaneAvailable(agent, laneIndex) {
    const laneAgents = this.laneMap.get(laneIndex)
    const laneEnterClearance = gameConfig.crowd.laneEnterClearance
    for (const neighbor of laneAgents) {
      if (Math.abs(neighbor.z - agent.z) < laneEnterClearance) {
        return false
      }
    }
    return true
  }

  /**
   * Compute reaction distance envelope for a given threat.
   * @param {object} threat
   * @returns {number}
   */
  _getReactionDistance(threat) {
    const safeDistance = gameConfig.crowd.safeDistance
    if (threat.isRear) {
      return safeDistance * gameConfig.crowd.rearYieldMultiplier
    }

    if (!threat.isFrontal) {
      return safeDistance
    }

    return safeDistance * gameConfig.crowd.frontalLookAheadMultiplier
  }

  /**
   * Decide if player behind should trigger a yield lane change.
   * @param {object} agent
   * @param {number} playerVelocityZ
   * @param {number} distance
   * @returns {boolean}
   */
  _isRearYieldThreat(agent, playerVelocityZ, distance) {
    const playerDirection = Math.sign(playerVelocityZ)
    const movingSameDirection = playerDirection !== 0 && playerDirection === agent.direction
    if (!movingSameDirection) {
      return false
    }

    const speedThreshold = gameConfig.crowd.rearYieldSpeedThreshold
    if (Math.abs(playerVelocityZ) < speedThreshold) {
      return false
    }

    const rearYieldDistance = gameConfig.crowd.safeDistance * gameConfig.crowd.rearYieldMultiplier
    return distance < rearYieldDistance
  }

  /**
   * Estimate player speed on z axis.
   * @param {number} playerZ
   * @param {number} deltaTime
   * @returns {number}
   */
  _computePlayerVelocityZ(playerZ, deltaTime) {
    return this._computePlayerVelocityAxis(playerZ, this.lastPlayerZ, deltaTime)
  }

  /**
   * Estimate one player velocity axis.
   * @param {number} currentAxis
   * @param {number | null} previousAxis
   * @param {number} deltaTime
   * @returns {number}
   */
  _computePlayerVelocityAxis(currentAxis, previousAxis, deltaTime) {
    if (previousAxis === null || deltaTime <= 0) {
      return 0
    }

    return (currentAxis - previousAxis) / deltaTime
  }

  /**
   * Clamp forward movement to keep a minimum gap with the closest agent ahead.
   * @param {object} agent
   * @param {number} proposedZ
   * @returns {number}
   */
  _limitForwardMotion(agent, proposedZ) {
    const laneAgents = this.laneMap.get(agent.laneIndex)
    const minForwardGap = gameConfig.crowd.minForwardGap
    let limitedZ = proposedZ

    for (const neighbor of laneAgents) {
      if (neighbor === agent) {
        continue
      }

      const dz = neighbor.z - agent.z
      const isAhead = agent.direction > 0 ? dz > 0 : dz < 0
      if (!isAhead) {
        continue
      }

      if (agent.direction > 0) {
        const maxAllowedZ = neighbor.z - minForwardGap
        if (limitedZ > maxAllowedZ) {
          limitedZ = maxAllowedZ
        }
      } else {
        const minAllowedZ = neighbor.z + minForwardGap
        if (limitedZ < minAllowedZ) {
          limitedZ = minAllowedZ
        }
      }
    }

    if (agent.direction > 0) {
      return Math.max(agent.z, limitedZ)
    }

    return Math.min(agent.z, limitedZ)
  }

  /**
   * Compute a lane change score including density and conflict risk.
   * @param {object} agent
   * @param {number} laneIndex
   * @param {object} threat
   * @returns {number}
   */
  _laneRiskScore(agent, laneIndex, threat) {
    const density = this._laneLocalDensity(laneIndex, agent.z)
    const oppositeDirectionCount = this._countOppositeDirectionNeighbors(laneIndex, agent.direction, agent.z)
    const preferredLane = this._getPreferredFrontalLane(agent)
    const frontalBonus = threat.type === "agent" && threat.isFrontal && laneIndex === preferredLane ? -0.35 : 0
    const tieBreaker = ((agent.id + laneIndex * 11) % 7) * 0.015

    return density + oppositeDirectionCount * 0.7 + tieBreaker + frontalBonus
  }

  /**
   * Count opposite direction neighbors close to a lane position.
   * @param {number} laneIndex
   * @param {number} direction
   * @param {number} z
   * @returns {number}
   */
  _countOppositeDirectionNeighbors(laneIndex, direction, z) {
    const laneAgents = this.laneMap.get(laneIndex)
    let count = 0
    for (const neighbor of laneAgents) {
      if (neighbor.direction === direction) {
        continue
      }
      if (Math.abs(neighbor.z - z) < 4.4) {
        count += 1
      }
    }
    return count
  }

  /**
   * Compute local lane density near a z position.
   * @param {number} laneIndex
   * @param {number} z
   * @returns {number}
   */
  _laneLocalDensity(laneIndex, z) {
    const laneAgents = this.laneMap.get(laneIndex)
    let density = 0
    for (const neighbor of laneAgents) {
      if (Math.abs(neighbor.z - z) < 6) {
        density += 1
      }
    }
    return density
  }

  /**
   * Teleport agents far from player to the opposite side.
   * @param {object} agent
   * @param {number} playerZ
   * @returns {void}
   */
  _recycleIfOutOfRange(agent, playerZ) {
    if (agent.isHitActive) {
      return
    }

    const maxDistance = gameConfig.crowd.spawnDistance
    const dz = agent.z - playerZ
    if (Math.abs(dz) < maxDistance) {
      return
    }

    const directionShift = dz > 0 ? -1 : 1
    this._respawnAgent(agent, playerZ, directionShift)
  }

  /**
   * Respawn one launched agent after it falls below destruction depth.
   * @param {object} agent
   * @param {number} playerZ
   * @returns {void}
   */
  _resetAgentAfterHit(agent, playerZ) {
    const directionShift = Math.random() > 0.5 ? 1 : -1
    this._respawnAgent(agent, playerZ, directionShift)
  }

  /**
   * Reinitialize one NPC with fresh spawn values.
   * @param {object} agent
   * @param {number} playerZ
   * @param {number} directionShift
   * @returns {void}
   */
  _respawnAgent(agent, playerZ, directionShift) {
    if (this.stoppedAgentId === agent.id) {
      this.stoppedAgentId = null
    }

    const maxDistance = gameConfig.crowd.spawnDistance
    agent.isInteractionStopped = false
    agent.isHitActive = false
    agent.hitState = null
    agent.hitSpinVelocityY = 0
    agent.y = this.walkwayTopY
    agent.laneIndex = this._randomNpcLaneIndex()
    agent.z = this._resolveRespawnZWithSpacing(playerZ, directionShift, agent.laneIndex, agent.id)
    agent.direction = Math.random() > 0.5 ? 1 : -1
    const speedProfile = this._createSpeedProfile(this._getRandomBaseSpeed())
    agent.baseSpeed = speedProfile.baseSpeed
    agent.currentSpeed = speedProfile.baseSpeed
    agent.speedVariationAmplitude = speedProfile.speedVariationAmplitude
    agent.speedVariationFrequency = speedProfile.speedVariationFrequency
    agent.speedVariationPhase = speedProfile.speedVariationPhase
    const faceProfile = this._createFaceProfile()
    agent.baseMood = faceProfile.mood
    agent.mood = faceProfile.mood
    agent.eyeShape = faceProfile.eyeShape
    agent.eyeScale = faceProfile.eyeScale
    agent.eyeSpacing = faceProfile.eyeSpacing
    agent.eyeYOffset = faceProfile.eyeYOffset
    agent.mouthScale = faceProfile.mouthScale
    agent.mouthYOffset = faceProfile.mouthYOffset
    agent.mouthArcDepth = faceProfile.mouthArcDepth
    agent.mouthTilt = faceProfile.mouthTilt
    agent.eyeColor = faceProfile.eyeColor
    agent.bodyVariant = this._pickBodyColorVariant()
    agent.faceLodVisible = true
    agent.lodSimulationAccumulator = 0
    agent.laneChangeCooldown = 0
    agent.x = this._laneToX(agent.laneIndex)
    agent.previousX = agent.x
    agent.previousY = agent.y
    agent.previousZ = agent.z
    agent.rotationX = 0
    agent.rotationY = 0
    agent.rotationZ = 0
    agent.previousRotationX = 0
    agent.previousRotationY = 0
    agent.previousRotationZ = 0
    this._syncAgentBodyColor(agent)
    this._syncAgentAppearance(agent)
  }

  /**
   * Resolve one initial spawn z while preserving minimum same-lane spacing.
   * @param {number} laneIndex
   * @returns {number}
   */
  _resolveInitialSpawnZWithSpacing(laneIndex) {
    const spawnDistance = Math.max(1, gameConfig.crowd.spawnDistance)
    return this._resolveSpawnZWithSpacing({
      laneIndex,
      minZ: -spawnDistance,
      maxZ: spawnDistance
    })
  }

  /**
   * Resolve one respawn z with a broad range to avoid visible spawn waves.
   * @param {number} playerZ
   * @param {number} directionShift
   * @param {number} laneIndex
   * @param {number} ignoredAgentId
   * @returns {number}
   */
  _resolveRespawnZWithSpacing(playerZ, directionShift, laneIndex, ignoredAgentId) {
    const spawnDistance = Math.max(1, gameConfig.crowd.spawnDistance)
    const minSpawnDistance = Math.min(spawnDistance, Math.max(24, spawnDistance * 0.55))
    const maxSpawnDistance = spawnDistance
    const minZ = playerZ + directionShift * minSpawnDistance
    const maxZ = playerZ + directionShift * maxSpawnDistance
    const lowerZ = Math.min(minZ, maxZ)
    const upperZ = Math.max(minZ, maxZ)

    return this._resolveSpawnZWithSpacing({
      laneIndex,
      minZ: lowerZ,
      maxZ: upperZ,
      ignoredAgentId
    })
  }

  /**
   * Resolve one spawn z with retry + fallback while enforcing same-lane spacing.
   * @param {{laneIndex: number, minZ: number, maxZ: number, ignoredAgentId?: number}} options
   * @returns {number}
   */
  _resolveSpawnZWithSpacing(options) {
    const { laneIndex, minZ, maxZ, ignoredAgentId = -1 } = options
    const safeMinZ = Math.min(minZ, maxZ)
    const safeMaxZ = Math.max(minZ, maxZ)
    const minSpawnGap = this._getSpawnMinGap()
    const maxAttempts = 20

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const candidateZ = THREE.MathUtils.randFloat(safeMinZ, safeMaxZ)
      if (!this._isSpawnZTooCloseOnLane(laneIndex, candidateZ, minSpawnGap, ignoredAgentId)) {
        return candidateZ
      }
    }

    let fallbackZ = THREE.MathUtils.randFloat(safeMinZ, safeMaxZ)
    const span = Math.max(0.001, safeMaxZ - safeMinZ)
    const fallbackStep = Math.max(minSpawnGap * 0.9, span / 10)
    for (let stepIndex = 0; stepIndex < 24; stepIndex += 1) {
      if (!this._isSpawnZTooCloseOnLane(laneIndex, fallbackZ, minSpawnGap, ignoredAgentId)) {
        return fallbackZ
      }
      fallbackZ += fallbackStep
      if (fallbackZ > safeMaxZ) {
        fallbackZ = safeMinZ + (fallbackZ - safeMaxZ)
      }
    }

    return fallbackZ
  }

  /**
   * Check whether one spawn z violates minimum spacing on a lane.
   * @param {number} laneIndex
   * @param {number} candidateZ
   * @param {number} minSpawnGap
   * @param {number} ignoredAgentId
   * @returns {boolean}
   */
  _isSpawnZTooCloseOnLane(laneIndex, candidateZ, minSpawnGap, ignoredAgentId = -1) {
    for (const neighbor of this.agents) {
      if (neighbor.id === ignoredAgentId) {
        continue
      }
      if (neighbor.isHitActive) {
        continue
      }
      if (neighbor.laneIndex !== laneIndex) {
        continue
      }
      if (Math.abs(neighbor.z - candidateZ) < minSpawnGap) {
        return true
      }
    }

    return false
  }

  /**
   * Resolve spawn spacing baseline from current crowd collision constraints.
   * @returns {number}
   */
  _getSpawnMinGap() {
    const explicitSpawnMinGap = Math.max(0, Number(gameConfig.crowd.spawnMinGap) || 0)
    const forwardGap = Math.max(0, gameConfig.crowd.minForwardGap)
    const laneClearance = Math.max(0, gameConfig.crowd.laneEnterClearance)
    return Math.max(2.6, explicitSpawnMinGap, forwardGap * 1.8, laneClearance * 1.4)
  }

  /**
   * Toggle one NPC mood to happy when crossing the player face-to-face.
   * @param {object} agent
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {void}
   */
  _updateAgentMoodFromPlayerProximity(agent, playerPosition, playerVelocityZ, playerFacingZ) {
    const shouldUseHappyMood = this._isFaceToFaceWithPlayer(agent, playerPosition, playerVelocityZ, playerFacingZ)
    const targetMood = shouldUseHappyMood ? "happy" : agent.baseMood
    this._setAgentMood(agent, targetMood)
  }

  /**
   * Check if one NPC is close enough and in opposite direction to player.
   * @param {object} agent
   * @param {THREE.Vector3} playerPosition
   * @param {number} playerVelocityZ
   * @param {number} playerFacingZ
   * @returns {boolean}
   */
  _isFaceToFaceWithPlayer(agent, playerPosition, playerVelocityZ, playerFacingZ) {
    let playerDirection = Math.sign(playerFacingZ)
    if (playerDirection === 0) {
      playerDirection = Math.sign(playerVelocityZ)
    }
    if (playerDirection === 0 || playerDirection === agent.direction) {
      return false
    }

    const deltaX = Math.abs(agent.x - playerPosition.x)
    const deltaZ = Math.abs(agent.z - playerPosition.z)
    if (deltaX > this.faceToFaceBoxHalfWidth || deltaZ > this.faceToFaceBoxHalfDepth) {
      return false
    }

    return true
  }

  /**
   * Apply one mood while keeping mouth placement stable.
   * @param {object} agent
   * @param {string} targetMood
   * @returns {void}
   */
  _setAgentMood(agent, targetMood) {
    if (agent.mood === targetMood) {
      return
    }

    const previousMoodYOffset = this._getMouthMoodYOffset(agent.mood)
    const nextMoodYOffset = this._getMouthMoodYOffset(targetMood)
    agent.mouthYOffset += previousMoodYOffset - nextMoodYOffset
    agent.mood = targetMood
    this._syncAgentAppearance(agent)
  }

  /**
   * Get renderer vertical mouth offset used by one mood.
   * @param {string} mood
   * @returns {number}
   */
  _getMouthMoodYOffset(mood) {
    if (mood === "sad") {
      return 0.035
    }

    if (mood === "neutral" || mood === "perplexed") {
      return 0.01
    }

    return 0
  }

  /**
   * Build one randomized speed profile for a crowd agent.
   * @param {number} baseSpeed
   * @returns {object}
   */
  _createSpeedProfile(baseSpeed) {
    const amplitudeScale = 0.65 + Math.random() * 0.55
    const speedVariationAmplitude = gameConfig.crowd.speedVariationAmplitude * amplitudeScale
    const frequencyMin = gameConfig.crowd.speedVariationFrequencyMin
    const frequencyMax = gameConfig.crowd.speedVariationFrequencyMax
    const speedVariationFrequency = frequencyMin + Math.random() * (frequencyMax - frequencyMin)
    const speedVariationPhase = Math.random() * Math.PI * 2

    return {
      baseSpeed,
      speedVariationAmplitude,
      speedVariationFrequency,
      speedVariationPhase
    }
  }

  /**
   * Compute animated desired speed for one agent.
   * @param {object} agent
   * @returns {number}
   */
  _computeAgentDesiredSpeed(agent) {
    const wave = Math.sin(this.simulationTime * agent.speedVariationFrequency + agent.speedVariationPhase)
    const modulation = 1 + wave * agent.speedVariationAmplitude
    const desiredSpeed = agent.baseSpeed * modulation
    return THREE.MathUtils.clamp(desiredSpeed, gameConfig.crowd.minSpeed, gameConfig.crowd.maxSpeed)
  }

  /**
   * Pick a random baseline walking speed.
   * @returns {number}
   */
  _getRandomBaseSpeed() {
    const minSpeed = gameConfig.crowd.minSpeed
    const maxSpeed = gameConfig.crowd.maxSpeed
    return minSpeed + Math.random() * (maxSpeed - minSpeed)
  }

  /**
   * Sync one agent transform into the instanced matrix buffer.
   * @param {object} agent
   * @param {number} renderX
   * @param {number} renderY
   * @param {number} renderZ
   * @param {number} renderRotationX
   * @param {number} renderRotationY
   * @param {number} renderRotationZ
   * @returns {void}
  */
  _syncAgentTransform(
    agent,
    renderX,
    renderY,
    renderZ,
    renderRotationX = 0,
    renderRotationY = 0,
    renderRotationZ = 0,
    playerPosition = { x: 0, z: 0 }
  ) {
    const distanceToPlayer = Math.abs(renderZ - playerPosition.z) + Math.abs(renderX - playerPosition.x) * 0.25
    const clipDistance = Math.max(0, gameConfig.crowd.renderClipDistance)
    const shouldRenderAgent = distanceToPlayer <= clipDistance
    if (!shouldRenderAgent) {
      this.crowdRenderer.setAgentMatrix(agent.instanceIndex, renderX, renderZ, -9999, false)
      return
    }

    const shouldRenderFace = this._computeFaceLodVisibility(agent, distanceToPlayer)
    this.crowdRenderer.setAgentMatrix(
      agent.instanceIndex,
      renderX,
      renderZ,
      renderY,
      shouldRenderFace,
      renderRotationX,
      renderRotationY,
      renderRotationZ
    )
  }

  /**
   * Build one random hit spin angular speed around y axis.
   * @returns {number}
   */
  _getHitSpinVelocityY() {
    const baseSpinSpeedDeg = Math.max(0, gameConfig.hit.hitSpinSpeedDeg)
    const spinDirection = Math.random() < 0.5 ? -1 : 1
    return THREE.MathUtils.degToRad(baseSpinSpeedDeg) * spinDirection
  }

  /**
   * Sync one agent facial appearance to the renderer.
   * @param {object} agent
   * @returns {void}
   */
  _syncAgentAppearance(agent) {
    this.crowdRenderer.setAgentAppearance(agent.instanceIndex, {
      mood: agent.mood,
      eyeShape: agent.eyeShape,
      eyeScale: agent.eyeScale,
      eyeSpacing: agent.eyeSpacing,
      eyeYOffset: agent.eyeYOffset,
      mouthScale: agent.mouthScale,
      mouthYOffset: agent.mouthYOffset,
      mouthArcDepth: agent.mouthArcDepth,
      mouthTilt: agent.mouthTilt,
      eyeColor: agent.eyeColor,
      facingDirection: agent.direction
    })
  }

  /**
   * Sync one agent body color variant to renderer.
   * @param {object} agent
   * @returns {void}
   */
  _syncAgentBodyColor(agent) {
    this.crowdRenderer.setAgentBodyVariant(agent.instanceIndex, agent.bodyVariant)
  }

  /**
   * Convert lane index to world x.
   * @param {number} laneIndex
   * @returns {number}
   */
  _laneToX(laneIndex) {
    return laneIndex * this.laneSpacing - this.laneCenterOffset
  }

  /**
   * Convert world x to lane index.
   * @param {number} x
   * @returns {number}
   */
  _xToLane(x) {
    const laneIndex = Math.round((x + this.laneCenterOffset) / this.laneSpacing)
    return THREE.MathUtils.clamp(laneIndex, 0, this.laneCount - 1)
  }

  /**
   * Check if one lane is allowed for NPC positions.
   * @param {number} laneIndex
   * @returns {boolean}
   */
  _isNpcLaneAllowed(laneIndex) {
    return laneIndex >= this.npcLaneMin && laneIndex <= this.npcLaneMax
  }

  /**
   * Pick one random lane index within NPC allowed range.
   * @returns {number}
   */
  _randomNpcLaneIndex() {
    const laneSpan = this.npcLaneMax - this.npcLaneMin + 1
    if (laneSpan <= 0) {
      return 0
    }

    return this.npcLaneMin + Math.floor(Math.random() * laneSpan)
  }

  /**
   * Create random face profile for one NPC mood and eyes.
   * @returns {object}
   */
  _createFaceProfile() {
    const moodRoll = Math.random()
    let mood = "neutral"
    if (moodRoll < 0.3) {
      mood = "happy"
    } else if (moodRoll < 0.6) {
      mood = "neutral"
    } else if (moodRoll < 0.9) {
      mood = "perplexed"
    } else {
      mood = "sad"
    }
    const eyeShapes = ["square", "rectangle", "round", "cross"]

    const eyeYOffset = 0.16 + Math.random() * 0.2
    const eyeMouthGap = 0.24 + Math.random() * 0.18
    const desiredMouthYOffset = eyeYOffset - eyeMouthGap + (Math.random() - 0.5) * 0.05
    const maxMouthYOffset = eyeYOffset - 0.2
    const mouthYOffset = Math.max(-0.12, Math.min(desiredMouthYOffset, maxMouthYOffset))
    const mouthTilt = mood === "perplexed" ? (Math.random() > 0.5 ? 1 : -1) * (0.09 + Math.random() * 0.15) : 0

    return {
      mood,
      eyeShape: eyeShapes[Math.floor(Math.random() * eyeShapes.length)],
      eyeScale: 0.62 + Math.random() * 0.86,
      eyeSpacing: 0.05 + Math.random() * 0.12,
      eyeYOffset,
      mouthScale: 0.7 + Math.random() * 0.68,
      mouthYOffset,
      mouthArcDepth: 0.55 + Math.random() * 0.9,
      mouthTilt,
      eyeColor: this._pickEyeColor()
    }
  }

  /**
   * Compute face visibility with hysteresis to prevent flicker.
   * @param {object} agent
   * @param {number} distanceToPlayer
   * @returns {boolean}
   */
  _computeFaceLodVisibility(agent, distanceToPlayer) {
    if (agent.faceLodVisible) {
      if (distanceToPlayer > this.faceDetailDistanceFar) {
        agent.faceLodVisible = false
      }
      return agent.faceLodVisible
    }

    if (distanceToPlayer < this.faceDetailDistance) {
      agent.faceLodVisible = true
    }

    return agent.faceLodVisible
  }

  /**
   * Pick one eye neon color.
   * @returns {number}
   */
  _pickEyeColor() {
    const eyePalette = [
      0x7df6ff,
      0x6cbcff,
      0xff88f7,
      0xa8ff74,
      0xffe17a,
      0xffa06b
    ]
    return eyePalette[Math.floor(Math.random() * eyePalette.length)]
  }

  /**
   * Pick body color variant from runtime boys/girls distribution.
   * @returns {"blue" | "pink"}
   */
  _pickBodyColorVariant() {
    const rawBoysSharePercent = Number(gameConfig.crowd.boysSharePercent)
    const boysSharePercent = THREE.MathUtils.clamp(
      Number.isFinite(rawBoysSharePercent) ? rawBoysSharePercent : 50,
      0,
      100
    )
    const boysShareRatio = boysSharePercent / 100
    return Math.random() < boysShareRatio ? "blue" : "pink"
  }

  /**
   * Consume per-agent simulation budget according to distance-based LOD.
   * @param {object} agent
   * @param {number} simulationDelta
   * @param {THREE.Vector3} playerPosition
   * @returns {number}
   */
  _consumeAgentSimulationDelta(agent, simulationDelta, playerPosition) {
    const distanceToPlayer = Math.abs(agent.z - playerPosition.z) + Math.abs(agent.x - playerPosition.x) * 0.25
    const simulationStepMultiplier = this._computeSimulationLodStepMultiplier(distanceToPlayer)
    const requiredDelta = this.simulationStep * simulationStepMultiplier

    if (simulationStepMultiplier <= 1) {
      return simulationDelta
    }

    agent.lodSimulationAccumulator += simulationDelta
    if (agent.lodSimulationAccumulator < requiredDelta) {
      return 0
    }

    const consumedDelta = agent.lodSimulationAccumulator
    agent.lodSimulationAccumulator = 0
    return consumedDelta
  }

  /**
   * Compute simulation frequency multiplier for one distance bucket.
   * @param {number} distanceToPlayer
   * @returns {number}
   */
  _computeSimulationLodStepMultiplier(distanceToPlayer) {
    if (distanceToPlayer < this.nearSimulationDistance) {
      return 1
    }

    if (distanceToPlayer < this.midSimulationDistance) {
      return 2
    }

    return 4
  }

  /**
   * Find one agent by instance index.
   * @param {number} instanceIndex
   * @returns {object | null}
   */
  _getAgentByInstanceIndex(instanceIndex) {
    for (const agent of this.agents) {
      if (agent.instanceIndex === instanceIndex) {
        return agent
      }
    }

    return null
  }

  /**
   * Find one agent by id.
   * @param {number} agentId
   * @returns {object | null}
   */
  _getAgentById(agentId) {
    for (const agent of this.agents) {
      if (agent.id === agentId) {
        return agent
      }
    }

    return null
  }
}
