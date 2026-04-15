/**
 * Level loader for JSON files stored in /public/levels.
 *
 * Usage:
 * const levels = await loadGameLevels()
 */
const MAX_LEVEL_SCAN = 200
const MAX_CONSECUTIVE_MISSES = 8

/**
 * Load and normalize levels from /public/levels/level_XX.json files.
 * @returns {Promise<object[]>}
 */
export async function loadGameLevels() {
  const loadedLevels = []
  let consecutiveMisses = 0

  for (let levelIndex = 1; levelIndex <= MAX_LEVEL_SCAN; levelIndex += 1) {
    const levelUrl = _buildLevelUrl(levelIndex)
    let response = null
    try {
      response = await fetch(levelUrl, { cache: "no-store" })
    } catch (error) {
      console.warn(`Failed to fetch level file "${levelUrl}"`, error)
      consecutiveMisses += 1
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        break
      }
      continue
    }

    if (!response.ok) {
      consecutiveMisses += 1
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        break
      }
      continue
    }

    if (!_isJsonResponse(response)) {
      consecutiveMisses += 1
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        break
      }
      continue
    }

    const rawContent = await response.text()
    if (_looksLikeHtml(rawContent)) {
      consecutiveMisses += 1
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        break
      }
      continue
    }

    consecutiveMisses = 0
    if (!rawContent.trim()) {
      console.warn(`Level file "${levelUrl}" is empty and has been ignored`)
      continue
    }

    try {
      const parsedLevel = JSON.parse(rawContent)
      loadedLevels.push(normalizeLevelDefinition(parsedLevel, levelIndex))
    } catch (error) {
      console.warn(`Failed to parse level file "${levelUrl}"`, error)
    }
  }

  if (loadedLevels.length <= 0) {
    console.warn("No valid level file found in /public/levels, using fallback level")
    return [normalizeLevelDefinition({}, 1)]
  }

  return loadedLevels
    .sort((leftLevel, rightLevel) => leftLevel.id - rightLevel.id)
    .map((levelDefinition, arrayIndex) => {
      if (levelDefinition.id > 0) {
        return levelDefinition
      }
      return {
        ...levelDefinition,
        id: arrayIndex + 1
      }
    })
}

/**
 * Normalize one loaded level object.
 * @param {object} sourceLevel
 * @param {number} fallbackId
 * @returns {object}
 */
export function normalizeLevelDefinition(sourceLevel, fallbackId = 1) {
  const level = sourceLevel ?? {}
  const normalizedId = Math.max(1, Math.round(Number(level.id) || fallbackId))

  return {
    id: normalizedId,
    target: {
      distance: _asNonNegativeInteger(level?.target?.distance),
      chrono: _asNonNegativeInteger(level?.target?.chrono),
      score: _asNonNegativeInteger(level?.target?.score),
      boysHit: _asNonNegativeInteger(level?.target?.boysHit),
      girlsHit: _asNonNegativeInteger(level?.target?.girlsHit)
    },
    lose: {
      boysHit: _asNonNegativeInteger(level?.lose?.boysHit),
      girlsHit: _asNonNegativeInteger(level?.lose?.girlsHit)
    },
    texts: {
      objective: _asText(level?.texts?.objective),
      win: _asText(level?.texts?.win),
      lose: _asText(level?.texts?.lose),
      nextLevel: _asText(level?.texts?.nextLevel),
      retry: _asText(level?.texts?.retry)
    },
    init: _asObject(level?.init)
  }
}

/**
 * Build one level URL from 1-based index.
 * @param {number} levelIndex
 * @returns {string}
 */
function _buildLevelUrl(levelIndex) {
  const indexText = String(levelIndex).padStart(2, "0")
  return `/levels/level_${indexText}.json`
}

/**
 * Convert unknown value to object.
 * @param {unknown} value
 * @returns {object}
 */
function _asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value
}

/**
 * Convert unknown value to non-negative integer.
 * @param {unknown} value
 * @returns {number}
 */
function _asNonNegativeInteger(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 0
  }
  return Math.max(0, Math.round(numericValue))
}

/**
 * Convert unknown value to plain text.
 * @param {unknown} value
 * @returns {string}
 */
function _asText(value) {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim()
}

/**
 * Check whether a fetch response is likely JSON.
 * @param {Response} response
 * @returns {boolean}
 */
function _isJsonResponse(response) {
  const contentType = response.headers.get("content-type") || ""
  const normalizedContentType = contentType.toLowerCase()
  return normalizedContentType.includes("application/json") || normalizedContentType.includes("text/json")
}

/**
 * Detect obvious HTML fallback payloads.
 * @param {string} rawContent
 * @returns {boolean}
 */
function _looksLikeHtml(rawContent) {
  const trimmedContent = rawContent.trim().toLowerCase()
  return trimmedContent.startsWith("<!doctype html") || trimmedContent.startsWith("<html")
}
