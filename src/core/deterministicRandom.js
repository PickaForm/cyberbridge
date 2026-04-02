/**
 * Deterministic random utilities based on string seeds.
 *
 * Usage:
 * import { createSeededRandom, deriveSeed } from "./core/deterministicRandom.js"
 * const rng = createSeededRandom(deriveSeed("cyberlove", 12))
 * const value = rng()
 */

/**
 * Build a derived numeric seed from a base seed and chunk index.
 * @param {string} baseSeed
 * @param {number} index
 * @returns {number}
 */
export function deriveSeed(baseSeed, index) {
  const hashFn = _xmur3(`${baseSeed}:${index}`)
  return hashFn()
}

/**
 * Create a deterministic random function in range [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function createSeededRandom(seed) {
  return _mulberry32(seed)
}

/**
 * Hash builder for string seeds.
 * @param {string} value
 * @returns {() => number}
 * @private
 * @ignore
 */
function _xmur3(value) {
  let hash = 1779033703 ^ value.length
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }

  return function _nextHash() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    return (hash ^= hash >>> 16) >>> 0
  }
}

/**
 * Fast seeded PRNG.
 * @param {number} seed
 * @returns {() => number}
 * @private
 * @ignore
 */
function _mulberry32(seed) {
  let current = seed >>> 0
  return function _nextValue() {
    let temp = (current += 0x6d2b79f5)
    temp = Math.imul(temp ^ (temp >>> 15), temp | 1)
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61)
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296
  }
}
