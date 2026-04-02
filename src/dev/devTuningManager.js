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
const DEV_TUNING_SHARED_PROFILE_PATH = "devTuningProfile.json"

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
    this._saveProfile()
    this._downloadProfileSnapshot(this.profile)
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
   * Hydrate runtime profile from shared JSON file when local storage has no profile.
   * @returns {Promise<void>}
   */
  async hydrateFromSharedProfile() {
    const storedProfile = this._readStoredProfile()
    if (storedProfile) {
      return
    }

    const sharedProfile = await this._readSharedProfile()
    if (!sharedProfile) {
      return
    }

    this.profile = this._normalizeProfile(sharedProfile)
  }

  /**
   * Load profile from JSON defaults + local storage current overrides.
   * @returns {object}
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _buildDefaultProfile() {
    return this._normalizeProfile(tuningDefaults)
  }

  /**
   * Read stored profile if present.
   * @returns {object | null}
   * @private
   * @ignore
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
   * Read shared profile from deployed public JSON file.
   * @returns {Promise<object | null>}
   * @private
   * @ignore
   */
  async _readSharedProfile() {
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return null
    }

    try {
      const basePath = import.meta.env.BASE_URL ?? "/"
      const profileUrl = new URL(DEV_TUNING_SHARED_PROFILE_PATH, window.location.origin + basePath)
      const response = await window.fetch(profileUrl.toString(), { cache: "no-store" })
      if (!response.ok) {
        return null
      }

      return await response.json()
    } catch (error) {
      console.warn("Failed to read shared dev tuning profile", error)
      return null
    }
  }

  /**
   * Persist profile to local storage.
   * @returns {void}
   * @private
   * @ignore
   */
  _saveProfile() {
    this._saveProfileData(this.profile)
  }

  /**
   * Persist provided profile to local storage.
   * @param {object} profile
   * @returns {void}
   * @private
   * @ignore
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
   * Align default reference values with current local profile values.
   * @param {object} profile
   * @returns {object}
   * @private
   * @ignore
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
   * Download a profile snapshot ready to publish as shared defaults file.
   * @param {object} profile
   * @returns {void}
   * @private
   * @ignore
   */
  _downloadProfileSnapshot(profile) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return
    }

    try {
      const profileJson = JSON.stringify(profile, null, 2)
      const blob = new Blob([profileJson], { type: "application/json;charset=utf-8" })
      const downloadUrl = URL.createObjectURL(blob)
      const anchorElement = document.createElement("a")
      anchorElement.href = downloadUrl
      anchorElement.download = DEV_TUNING_SHARED_PROFILE_PATH
      anchorElement.style.display = "none"
      document.body.appendChild(anchorElement)
      anchorElement.click()
      document.body.removeChild(anchorElement)
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.warn("Failed to download shared dev tuning profile snapshot", error)
    }
  }

  /**
   * Normalize profile structure and clamp values.
   * @param {object} sourceProfile
   * @returns {object}
   * @private
   * @ignore
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
   * @private
   * @ignore
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
   * @private
   * @ignore
   */
  _applyToGameConfig(currentValues) {
    const playerValues = currentValues.player ?? {}
    gameConfig.player.moveSpeed = _asNumber(playerValues.moveSpeed, gameConfig.player.moveSpeed)
    gameConfig.player.strafeSpeed = _asNumber(playerValues.strafeSpeed, gameConfig.player.strafeSpeed)
    gameConfig.player.xMargin = _asNumber(playerValues.xMargin, gameConfig.player.xMargin)

    const crowdValues = currentValues.crowd ?? {}
    gameConfig.crowd.maxAgents = Math.max(1, Math.round(_asNumber(crowdValues.maxAgents, gameConfig.crowd.maxAgents)))
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

    const flyingCarsValues = currentValues.flyingCars ?? {}
    gameConfig.flyingCars.maxCars = Math.max(1, Math.round(_asNumber(flyingCarsValues.maxCars, gameConfig.flyingCars.maxCars)))
    gameConfig.flyingCars.spawnDistance = _asNumber(flyingCarsValues.spawnDistance, gameConfig.flyingCars.spawnDistance)
    gameConfig.flyingCars.renderClipDistance = _asNumber(flyingCarsValues.renderClipDistance, gameConfig.flyingCars.renderClipDistance)
    gameConfig.flyingCars.speed = _asNumber(flyingCarsValues.speed, gameConfig.flyingCars.speed)
    gameConfig.flyingCars.lanesPerDirection = _clampInteger(_asNumber(flyingCarsValues.lanesPerDirection, gameConfig.flyingCars.lanesPerDirection), 1, 4)
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
  }

  /**
   * Sanitize value using type metadata.
   * @param {unknown} value
   * @param {object} paramSchema
   * @returns {unknown}
   * @private
   * @ignore
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
 * @private
 * @ignore
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
 * @private
 * @ignore
 */
function _clampInteger(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, Math.round(value)))
}

/**
 * Normalize a color value to 6-char lower-case hex.
 * @param {unknown} value
 * @param {unknown} fallbackValue
 * @returns {string}
 * @private
 * @ignore
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
 * @private
 * @ignore
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
 * @private
 * @ignore
 */
function _cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}
