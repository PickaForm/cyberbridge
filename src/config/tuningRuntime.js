/**
 * Runtime tuning values shared by render/game modules.
 *
 * Usage:
 * setRuntimeTuningValues({ player: { color: "ffe16e" } })
 * const color = getRuntimeTuningColor("player.color", 0xffe16e)
 */
let runtimeTuningValues = {}

/**
 * Replace runtime tuning object.
 * @param {object} values
 * @returns {void}
 */
export function setRuntimeTuningValues(values) {
  runtimeTuningValues = values ?? {}
}

/**
 * Read one runtime tuning value by dotted path.
 * @param {string} path
 * @param {unknown} fallbackValue
 * @returns {unknown}
 */
export function getRuntimeTuningValue(path, fallbackValue) {
  const value = _readByPath(runtimeTuningValues, path)
  if (value === undefined || value === null) {
    return fallbackValue
  }
  return value
}

/**
 * Read one runtime tuning numeric value.
 * @param {string} path
 * @param {number} fallbackValue
 * @returns {number}
 */
export function getRuntimeTuningNumber(path, fallbackValue) {
  const value = getRuntimeTuningValue(path, fallbackValue)
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallbackValue
  }
  return numericValue
}

/**
 * Read one runtime tuning color as hex integer.
 * @param {string} path
 * @param {number} fallbackHex
 * @returns {number}
 */
export function getRuntimeTuningColor(path, fallbackHex) {
  const value = getRuntimeTuningValue(path, fallbackHex)

  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value !== "string") {
    return fallbackHex
  }

  const normalizedHex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    return fallbackHex
  }

  return Number.parseInt(normalizedHex, 16)
}

/**
 * Read a nested value by dotted path.
 * @param {object} source
 * @param {string} path
 * @returns {unknown}
 * @private
 * @ignore
 */
function _readByPath(source, path) {
  const pathSegments = path.split(".")
  let currentValue = source

  for (const segment of pathSegments) {
    if (!currentValue || typeof currentValue !== "object" || !(segment in currentValue)) {
      return undefined
    }
    currentValue = currentValue[segment]
  }

  return currentValue
}
