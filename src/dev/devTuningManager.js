/**
 * Dev tuning manager with JSON profile + local persistence.
 *
 * Usage:
 * const tuningManager = new DevTuningManager()
 * tuningManager.applyRuntime()
 */
import tuningDefaults from "./devTuningDefaults.json"
import { gameConfig } from "../config/gameConfig.js"
import { setRuntimeTuningValues } from "../config/tuningRuntime.js"

const DEV_TUNING_STORAGE_KEY = "cyberlove-dev-tuning-v1"

export class DevTuningManager {
  /**
   * @param {Storage | null} storage
   */
  constructor(storage = window.localStorage) {
    this.storage = storage
    this.profile = this._loadProfile()
  }

  /**
   * Apply current tuning values into runtime systems.
   * @returns {void}
   */
  applyRuntime() {
    const currentValues = this._extractCurrentValues(this.profile)
    this._applyToGameConfig(currentValues)
    setRuntimeTuningValues(currentValues)
  }

  /**
   * Apply a profile live without persistence or page reload.
   * @param {object} nextProfile
   * @returns {void}
   */
  applyProfileLive(nextProfile) {
    this.profile = this._normalizeProfile(nextProfile)
    this.applyRuntime()
  }

  /**
   * Return a deep-cloned profile for UI editing.
   * @returns {object}
   */
  getProfileClone() {
    return _cloneValue(this.profile)
  }

  /**
   * Save a profile, persist it, and restart rendering.
   * @param {object} nextProfile
   * @returns {void}
   */
  saveAndRestart(nextProfile) {
    const normalizedProfile = this._normalizeProfile(nextProfile)
    this.profile = this._alignDefaultValuesWithCurrent(normalizedProfile)
    this._downloadProfileAsJson(this.profile)
    this._saveProfile()
    window.location.reload()
  }

  /**
   * Reset current values to defaults, persist, and restart rendering.
   * @returns {void}
   */
  resetAndRestart() {
    this.profile = this._buildDefaultProfile()
    this._saveProfile()
    window.location.reload()
  }

  /**
   * Load profile from JSON defaults + local storage current overrides.
   * @returns {object}
   */
  _loadProfile() {
    const defaultProfile = this._buildDefaultProfile()
    const storedProfile = this._readStoredProfile()
    if (!storedProfile) {
      return defaultProfile
    }

    const normalizedProfile = this._normalizeProfile(storedProfile)
    const alignedProfile = this._alignDefaultValuesWithCurrent(normalizedProfile)
    this._saveProfileData(alignedProfile)
    return alignedProfile
  }

  /**
   * Build immutable baseline profile from JSON defaults.
   * @returns {object}
   */
  _buildDefaultProfile() {
    return this._normalizeProfile(tuningDefaults)
  }

  /**
   * Read stored profile if present.
   * @returns {object | null}
   */
  _readStoredProfile() {
    if (!this.storage) {
      return null
    }

    try {
      const rawValue = this.storage.getItem(DEV_TUNING_STORAGE_KEY)
      if (!rawValue) {
        return null
      }
      return JSON.parse(rawValue)
    } catch (error) {
      console.warn("Failed to read dev tuning profile from storage", error)
      return null
    }
  }

  /**
   * Persist profile to local storage.
   * @returns {void}
   */
  _saveProfile() {
    this._saveProfileData(this.profile)
  }

  /**
   * Persist provided profile to local storage.
   * @param {object} profile
   * @returns {void}
   */
  _saveProfileData(profile) {
    if (!this.storage) {
      return
    }

    try {
      this.storage.setItem(DEV_TUNING_STORAGE_KEY, JSON.stringify(profile))
    } catch (error) {
      console.warn("Failed to persist dev tuning profile", error)
    }
  }

  /**
   * Download the full profile as JSON to ease defaults copy/paste.
   * @param {object} profile
   * @returns {void}
   */
  _downloadProfileAsJson(profile) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return
    }

    try {
      const jsonContent = `${JSON.stringify(profile, null, 2)}\n`
      const fileBlob = new Blob([jsonContent], { type: "application/json;charset=utf-8" })
      const downloadUrl = URL.createObjectURL(fileBlob)
      const downloadLink = document.createElement("a")
      downloadLink.href = downloadUrl
      downloadLink.download = "devTuningDefaults.generated.json"
      downloadLink.style.display = "none"
      document.body.appendChild(downloadLink)
      downloadLink.click()
      document.body.removeChild(downloadLink)
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.warn("Failed to download dev tuning profile", error)
    }
  }

  /**
   * Align default reference values with current local profile values.
   * @param {object} profile
   * @returns {object}
   */
  _alignDefaultValuesWithCurrent(profile) {
    const profileClone = _cloneValue(profile)

    for (const section of Object.values(profileClone)) {
      if (!section || typeof section !== "object") {
        continue
      }

      for (const parameter of Object.values(section)) {
        if (!parameter || typeof parameter !== "object" || !("current" in parameter)) {
          continue
        }

        parameter.default = parameter.current
      }
    }

    return profileClone
  }

  /**
   * Normalize profile structure and clamp values.
   * @param {object} sourceProfile
   * @returns {object}
   */
  _normalizeProfile(sourceProfile) {
    const normalizedProfile = {}
    const sourceSections = sourceProfile ?? {}

    for (const [sectionKey, defaultsSection] of Object.entries(tuningDefaults)) {
      normalizedProfile[sectionKey] = {}
      const sourceSection = sourceSections[sectionKey] ?? {}

      for (const [paramKey, defaultsParam] of Object.entries(defaultsSection)) {
        const sourceParam = sourceSection[paramKey] ?? {}
        const defaultValue = defaultsParam.default
        const currentValue = sourceParam.current ?? sourceParam.default ?? defaultsParam.current ?? defaultsParam.default
        const sanitizedDefault = this._sanitizeValue(defaultValue, defaultsParam)
        const sanitizedCurrent = this._sanitizeValue(currentValue, { ...defaultsParam, default: sanitizedDefault })

        normalizedProfile[sectionKey][paramKey] = {
          ...defaultsParam,
          default: sanitizedDefault,
          current: sanitizedCurrent
        }
      }
    }

    return normalizedProfile
  }

  /**
   * Convert profile to raw current-value object.
   * @param {object} profile
   * @returns {object}
   */
  _extractCurrentValues(profile) {
    const currentValues = {}

    for (const [sectionKey, sectionValues] of Object.entries(profile)) {
      currentValues[sectionKey] = {}
      for (const [paramKey, paramValue] of Object.entries(sectionValues)) {
        currentValues[sectionKey][paramKey] = paramValue.current
      }
    }

    return currentValues
  }

  /**
   * Apply relevant tuning values into gameConfig.
   * @param {object} currentValues
   * @returns {void}
   */
  _applyToGameConfig(currentValues) {
    const playerValues = currentValues.player ?? {}
    gameConfig.player.moveSpeed = _asNumber(playerValues.moveSpeed, gameConfig.player.moveSpeed)
    gameConfig.player.strafeSpeed = _asNumber(playerValues.strafeSpeed, gameConfig.player.strafeSpeed)
    gameConfig.player.collisionRadius = Math.max(0, _asNumber(playerValues.collisionRadius, gameConfig.player.collisionRadius))
    gameConfig.player.jumpHeight = Math.max(0, _asNumber(playerValues.jumpHeight, gameConfig.player.jumpHeight))
    gameConfig.player.gravity = Math.max(0.01, _asNumber(playerValues.gravity, gameConfig.player.gravity))
    gameConfig.player.scoreSize = Math.max(10, _asNumber(playerValues.scoreSize, gameConfig.player.scoreSize))
    gameConfig.player.distanceCoef = Math.max(0, _asNumber(playerValues.distanceCoef, gameConfig.player.distanceCoef))
    gameConfig.player.xMargin = _asNumber(playerValues.xMargin, gameConfig.player.xMargin)
    gameConfig.player.cameraElasticity = Math.max(
      0.1,
      _asNumber(playerValues.cameraElasticity, gameConfig.player.cameraElasticity)
    )

    const crowdValues = currentValues.crowd ?? {}
    gameConfig.crowd.maxAgents = Math.max(1, Math.round(_asNumber(crowdValues.maxAgents, gameConfig.crowd.maxAgents)))
    gameConfig.crowd.boysSharePercent = Math.min(100, Math.max(0, _asNumber(crowdValues.boysSharePercent, gameConfig.crowd.boysSharePercent)))
    gameConfig.crowd.spawnLanesPerDirection = _clampInteger(
      _asNumber(crowdValues.spawnLanesPerDirection, gameConfig.crowd.spawnLanesPerDirection),
      1,
      8
    )
    gameConfig.crowd.laneSpacing = Math.max(0.2, _asNumber(crowdValues.laneSpacing, gameConfig.crowd.laneSpacing))
    gameConfig.crowd.spawnDistance = _asNumber(crowdValues.spawnDistance, gameConfig.crowd.spawnDistance)
    gameConfig.crowd.minSpeed = _asNumber(crowdValues.minSpeed, gameConfig.crowd.minSpeed)
    gameConfig.crowd.maxSpeed = _asNumber(crowdValues.maxSpeed, gameConfig.crowd.maxSpeed)
    gameConfig.crowd.speedVariationAmplitude = _asNumber(crowdValues.speedVariationAmplitude, gameConfig.crowd.speedVariationAmplitude)
    gameConfig.crowd.speedVariationFrequencyMin = _asNumber(crowdValues.speedVariationFrequencyMin, gameConfig.crowd.speedVariationFrequencyMin)
    gameConfig.crowd.speedVariationFrequencyMax = _asNumber(crowdValues.speedVariationFrequencyMax, gameConfig.crowd.speedVariationFrequencyMax)
    gameConfig.crowd.safeDistance = _asNumber(crowdValues.safeDistance, gameConfig.crowd.safeDistance)
    gameConfig.crowd.frontalLookAheadMultiplier = _asNumber(crowdValues.frontalLookAheadMultiplier, gameConfig.crowd.frontalLookAheadMultiplier)
    gameConfig.crowd.rearYieldMultiplier = _asNumber(crowdValues.rearYieldMultiplier, gameConfig.crowd.rearYieldMultiplier)
    gameConfig.crowd.rearYieldSpeedThreshold = _asNumber(crowdValues.rearYieldSpeedThreshold, gameConfig.crowd.rearYieldSpeedThreshold)
    gameConfig.crowd.laneEnterClearance = _asNumber(crowdValues.laneEnterClearance, gameConfig.crowd.laneEnterClearance)
    gameConfig.crowd.minForwardGap = _asNumber(crowdValues.minForwardGap, gameConfig.crowd.minForwardGap)
    gameConfig.crowd.laneChangeCooldown = _asNumber(crowdValues.laneChangeCooldown, gameConfig.crowd.laneChangeCooldown)
    gameConfig.crowd.simulationHz = Math.max(1, Math.round(_asNumber(crowdValues.simulationHz, gameConfig.crowd.simulationHz)))
    gameConfig.crowd.maxSimulationStepsPerFrame = Math.max(
      1,
      Math.round(_asNumber(crowdValues.maxSimulationStepsPerFrame, gameConfig.crowd.maxSimulationStepsPerFrame))
    )
    gameConfig.crowd.renderClipDistance = _asNumber(crowdValues.renderClipDistance, gameConfig.crowd.renderClipDistance)

    const hitValues = currentValues.hit ?? {}
    gameConfig.hit.arcHeight = _asNumber(hitValues.arcHeight, gameConfig.hit.arcHeight)
    gameConfig.hit.arcWidth = Math.max(0, _asNumber(hitValues.arcWidth, gameConfig.hit.arcWidth))
    gameConfig.hit.fallDepth = Math.max(0.2, _asNumber(hitValues.fallDepth, gameConfig.hit.fallDepth))
    gameConfig.hit.initialSpeed = Math.max(0.1, _asNumber(hitValues.initialSpeed, gameConfig.hit.initialSpeed))
    gameConfig.hit.launchAngleDeg = Math.min(85, Math.max(0, _asNumber(hitValues.launchAngleDeg, gameConfig.hit.launchAngleDeg)))
    gameConfig.hit.hitSpinSpeedDeg = Math.max(0, _asNumber(hitValues.hitSpinSpeedDeg, gameConfig.hit.hitSpinSpeedDeg))

    const soundValues = currentValues.sound ?? {}
    gameConfig.sound.musicVolume = Math.min(100, Math.max(0, _asNumber(soundValues.musicVolume, gameConfig.sound.musicVolume)))
    gameConfig.sound.hitVolume = Math.min(100, Math.max(0, _asNumber(soundValues.hitVolume, gameConfig.sound.hitVolume)))

    const flyingCarsValues = currentValues.flyingCars ?? {}
    gameConfig.flyingCars.maxCars = Math.max(1, Math.round(_asNumber(flyingCarsValues.maxCars, gameConfig.flyingCars.maxCars)))
    gameConfig.flyingCars.spawnDistance = _asNumber(flyingCarsValues.spawnDistance, gameConfig.flyingCars.spawnDistance)
    gameConfig.flyingCars.renderClipDistance = _asNumber(flyingCarsValues.renderClipDistance, gameConfig.flyingCars.renderClipDistance)
    gameConfig.flyingCars.speed = _asNumber(flyingCarsValues.speed, gameConfig.flyingCars.speed)
    gameConfig.flyingCars.scale = Math.max(0.05, _asNumber(flyingCarsValues.scale, gameConfig.flyingCars.scale))
    gameConfig.flyingCars.lanesPerDirection = _clampInteger(_asNumber(flyingCarsValues.lanesPerDirection, gameConfig.flyingCars.lanesPerDirection), 1, 6)
    gameConfig.flyingCars.levelsCount = Math.max(1, Math.round(_asNumber(flyingCarsValues.levelsCount, gameConfig.flyingCars.levelsCount)))
    gameConfig.flyingCars.laneSpacing = _asNumber(flyingCarsValues.laneSpacing, gameConfig.flyingCars.laneSpacing)
    gameConfig.flyingCars.firstLevelHeight = _asNumber(flyingCarsValues.firstLevelHeight, gameConfig.flyingCars.firstLevelHeight)
    gameConfig.flyingCars.levelSpacing = _asNumber(flyingCarsValues.levelSpacing, gameConfig.flyingCars.levelSpacing)
    gameConfig.flyingCars.glowChance = Math.min(1, Math.max(0, _asNumber(flyingCarsValues.glowChance, gameConfig.flyingCars.glowChance)))
    gameConfig.flyingCars.nonGlowLuminosity = Math.max(0.2, _asNumber(flyingCarsValues.nonGlowLuminosity, gameConfig.flyingCars.nonGlowLuminosity))
    gameConfig.flyingCars.glowIntensity = Math.min(3, Math.max(0, _asNumber(flyingCarsValues.glowIntensity, gameConfig.flyingCars.glowIntensity)))

    const buildingValues = currentValues.buildings ?? {}
    gameConfig.world.buildingRowsPerSide = Math.max(1, Math.round(_asNumber(buildingValues.rowsPerSide, gameConfig.world.buildingRowsPerSide)))
    gameConfig.world.buildingGapFromWalkway = _asNumber(buildingValues.gapFromWalkway, gameConfig.world.buildingGapFromWalkway)
    gameConfig.world.walkwayWidth = Math.max(4, _asNumber(buildingValues.walkwayWidth, gameConfig.world.walkwayWidth))
  }

  /**
   * Sanitize value using type metadata.
   * @param {unknown} value
   * @param {object} paramSchema
   * @returns {unknown}
   */
  _sanitizeValue(value, paramSchema) {
    if (paramSchema.type === "color") {
      return _sanitizeColor(value, paramSchema.default)
    }

    if (paramSchema.type === "number") {
      const numericValue = _asNumber(value, _asNumber(paramSchema.default, 0))
      const min = Number.isFinite(Number(paramSchema.min)) ? Number(paramSchema.min) : -Infinity
      const max = Number.isFinite(Number(paramSchema.max)) ? Number(paramSchema.max) : Infinity
      return Math.min(max, Math.max(min, numericValue))
    }

    return String(value ?? "")
  }
}

/**
 * Convert unknown value to finite number.
 * @param {unknown} value
 * @param {number} fallbackValue
 * @returns {number}
 */
function _asNumber(value, fallbackValue) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallbackValue
  }
  return numericValue
}

/**
 * Clamp integer value between bounds.
 * @param {number} value
 * @param {number} minValue
 * @param {number} maxValue
 * @returns {number}
 */
function _clampInteger(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, Math.round(value)))
}

/**
 * Normalize a color value to 6-char lower-case hex.
 * @param {unknown} value
 * @param {unknown} fallbackValue
 * @returns {string}
 */
function _sanitizeColor(value, fallbackValue) {
  const normalizedFallback = _normalizeHex(fallbackValue, "ffffff")
  return _normalizeHex(value, normalizedFallback)
}

/**
 * Normalize hex input.
 * @param {unknown} value
 * @param {string} fallbackValue
 * @returns {string}
 */
function _normalizeHex(value, fallbackValue) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString(16).padStart(6, "0").slice(-6)
  }

  if (typeof value !== "string") {
    return fallbackValue
  }

  const cleanedHex = value.trim().replace(/^#/, "").toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(cleanedHex)) {
    return fallbackValue
  }

  return cleanedHex
}

/**
 * Deep clone JSON-compatible value.
 * @param {unknown} value
 * @returns {any}
 */
function _cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}
