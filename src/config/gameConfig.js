/**
 * Cyberlove POC shared configuration.
 *
 * Usage:
 * import { gameConfig } from "./config/gameConfig.js"
 * console.log(gameConfig.world.walkwayWidth)
 */
export const gameConfig = {
  world: {
    seed: "cyberlove-v1",
    chunkLength: 48,
    visibleChunksAhead: 8,
    visibleChunksBehind: 3,
    walkwayWidth: 22,
    walkwayHeight: 0.8,
    laneCount: 10,
    buildingRowsPerSide: 7,
    buildingGapFromWalkway: 8
  },
  player: {
    moveSpeed: 10,
    strafeSpeed: 8,
    xMargin: 0.9
  },
  crowd: {
    maxAgents: 140,
    spawnDistance: 240,
    minSpeed: 1.6,
    maxSpeed: 4.8,
    speedVariationAmplitude: 0.22,
    speedVariationFrequencyMin: 0.25,
    speedVariationFrequencyMax: 0.8,
    safeDistance: 3.2,
    frontalLookAheadMultiplier: 1.9,
    rearYieldMultiplier: 1.35,
    rearYieldSpeedThreshold: 1.05,
    laneEnterClearance: 2.25,
    minForwardGap: 1.85,
    laneChangeCooldown: 0.9,
    simulationHz: 20,
    maxSimulationStepsPerFrame: 3,
    renderClipDistance: 120
  },
  hit: {
    arcHeight: 3.8,
    arcWidth: 0,
    fallDepth: 38,
    initialSpeed: 16,
    launchAngleDeg: 45,
    hitSpinSpeedDeg: 720
  },
  sound: {
    musicVolume: 26,
    hitVolume: 90
  },
  flyingCars: {
    maxCars: 120,
    spawnDistance: 260,
    renderClipDistance: 180,
    speed: 13,
    lanesPerDirection: 2,
    levelsCount: 2,
    laneSpacing: 2.1,
    firstLevelHeight: 7.5,
    levelSpacing: 4.4,
    glowChance: 0.28,
    nonGlowLuminosity: 1,
    glowIntensity: 1
  },
  camera: {
    minDistance: 3.5,
    maxDistance: 24,
    defaultDistance: 8.5,
    yaw: Math.PI,
    pitch: 1.1
  },
  render: {
    fogColor: 0x1f3d60,
    fogDensity: 0.0082,
    backgroundTopColor: 0x0c2146,
    backgroundMidColor: 0x1a3d6d,
    backgroundBottomColor: 0x2c5f8f,
    bloomStrength: 1.35,
    bloomRadius: 0.42,
    bloomThreshold: 0.15
  }
}
