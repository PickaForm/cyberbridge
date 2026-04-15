/**
 * Level loader for JSON files stored in /public/levels.
 *
 * Usage:
 * const levels = await loadGameLevels()
 */
const MAX_LEVEL_SCAN = 200
const MAX_CONSECUTIVE_MISSES = 8
const LEVEL_MANIFEST_URL = "/levels/levels.json"

/**
 * Load and normalize levels from /public/levels/level_XX.json files.
 * @returns {Promise<object[]>}
 */
export async function loadGameLevels() {
  const manifestLoadedLevels = await _loadLevelsFromManifest()
  if (manifestLoadedLevels.length > 0) {
    return _sortAndNormalizeLoadedLevels(manifestLoadedLevels)
  }

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

  return _sortAndNormalizeLoadedLevels(loadedLevels)
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
      objective: _asLocalizedText(level?.texts?.objective),
      win: _asLocalizedText(level?.texts?.win),
      lose: _asLocalizedText(level?.texts?.lose),
      nextLevel: _asLocalizedText(level?.texts?.nextLevel),
      retry: _asLocalizedText(level?.texts?.retry)
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
 * Load levels using an explicit manifest file to avoid 404 probes.
 * @returns {Promise<object[]>}
 */
async function _loadLevelsFromManifest() {
  let response = null
  try {
    response = await fetch(LEVEL_MANIFEST_URL, { cache: "no-store" })
  } catch (error) {
    return []
  }

  if (!response?.ok || !_isJsonResponse(response)) {
    return []
  }

  let parsedManifest = null
  try {
    parsedManifest = await response.json()
  } catch (error) {
    console.warn(`Failed to parse level manifest "${LEVEL_MANIFEST_URL}"`, error)
    return []
  }

  const levelUrls = _extractLevelUrlsFromManifest(parsedManifest)
  if (levelUrls.length <= 0) {
    return []
  }

  const loadedLevels = []
  for (let entryIndex = 0; entryIndex < levelUrls.length; entryIndex += 1) {
    const levelUrl = levelUrls[entryIndex]
    const parsedLevel = await _loadOneLevelFromUrl(levelUrl, entryIndex + 1)
    if (parsedLevel) {
      loadedLevels.push(parsedLevel)
    }
  }

  return loadedLevels
}

/**
 * Extract level URLs from supported manifest shapes.
 * @param {unknown} parsedManifest
 * @returns {string[]}
 */
function _extractLevelUrlsFromManifest(parsedManifest) {
  const levelEntries = Array.isArray(parsedManifest) ? parsedManifest : parsedManifest?.levels
  if (!Array.isArray(levelEntries) || levelEntries.length <= 0) {
    return []
  }

  const levelUrls = []
  for (const rawEntry of levelEntries) {
    if (typeof rawEntry === "number" && Number.isFinite(rawEntry)) {
      levelUrls.push(_buildLevelUrl(Math.max(1, Math.round(rawEntry))))
      continue
    }

    if (typeof rawEntry === "string") {
      const trimmedEntry = rawEntry.trim()
      if (!trimmedEntry) {
        continue
      }

      if (trimmedEntry.startsWith("/")) {
        levelUrls.push(trimmedEntry)
      } else {
        levelUrls.push(`/levels/${trimmedEntry}`)
      }
      continue
    }

    if (rawEntry && typeof rawEntry === "object" && typeof rawEntry.url === "string") {
      const trimmedUrl = rawEntry.url.trim()
      if (!trimmedUrl) {
        continue
      }

      if (trimmedUrl.startsWith("/")) {
        levelUrls.push(trimmedUrl)
      } else {
        levelUrls.push(`/levels/${trimmedUrl}`)
      }
    }
  }

  return levelUrls
}

/**
 * Load and normalize one level file.
 * @param {string} levelUrl
 * @param {number} fallbackId
 * @returns {Promise<object | null>}
 */
async function _loadOneLevelFromUrl(levelUrl, fallbackId) {
  let response = null
  try {
    response = await fetch(levelUrl, { cache: "no-store" })
  } catch (error) {
    console.warn(`Failed to fetch level file "${levelUrl}"`, error)
    return null
  }

  if (!response.ok || !_isJsonResponse(response)) {
    console.warn(`Level file "${levelUrl}" is unavailable or not JSON`)
    return null
  }

  const rawContent = await response.text()
  if (_looksLikeHtml(rawContent)) {
    console.warn(`Level file "${levelUrl}" returned HTML and has been ignored`)
    return null
  }

  if (!rawContent.trim()) {
    console.warn(`Level file "${levelUrl}" is empty and has been ignored`)
    return null
  }

  try {
    const parsedLevel = JSON.parse(rawContent)
    return normalizeLevelDefinition(parsedLevel, fallbackId)
  } catch (error) {
    console.warn(`Failed to parse level file "${levelUrl}"`, error)
    return null
  }
}

/**
 * Sort levels and ensure fallback ids are stable.
 * @param {object[]} loadedLevels
 * @returns {object[]}
 */
function _sortAndNormalizeLoadedLevels(loadedLevels) {
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
 * Convert unknown value to { fr, en } localized text object.
 * @param {unknown} value
 * @returns {{ fr: string, en: string }}
 */
function _asLocalizedText(value) {
  if (typeof value === "string") {
    const normalizedText = _asText(value)
    return {
      fr: normalizedText,
      en: normalizedText
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      fr: "",
      en: ""
    }
  }

  return {
    fr: _asText(value.fr),
    en: _asText(value.en)
  }
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
