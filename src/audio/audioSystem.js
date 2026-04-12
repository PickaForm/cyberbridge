/**
 * Audio orchestration for background music and gameplay SFX.
 *
 * Usage:
 * const audioSystem = new AudioSystem()
 * audioSystem.attachUnlockListeners(window)
 * audioSystem.playHitSound()
 */
export class AudioSystem {
  /**
   * @param {object} options
   * @param {string} options.musicUrl
   * @param {string[]} options.hitSfxUrls
   * @param {string} options.hitAutoPrefix
   * @param {string} options.hitAutoExtension
 * @param {number} options.maxHitVariants
 * @param {number} options.musicVolume
 * @param {number} options.hitVolume
 * @param {number} options.hitPoolPerVariant
 * @param {number} options.hitBurstSpacingMs
 * @param {number} options.hitBurstMaxQueue
 */
  constructor(options = {}) {
    const {
      musicUrl = "/audio/music.mp3",
      hitSfxUrls = [],
      hitAutoPrefix = "/audio/sfx-npc-hit-slap-",
      hitAutoExtension = "wav",
      maxHitVariants = 12,
      musicVolume = 0.26,
      hitVolume = 0.9,
      hitPoolPerVariant = 6,
      hitBurstSpacingMs = 28,
      hitBurstMaxQueue = 64
    } = options

    this._unlockTarget = null
    this._hasUnlocked = false
    this._isMusicStarted = false
    this._onUnlockInteraction = this._onUnlockInteraction.bind(this)
    this.hitVolume = _clampVolume(hitVolume)
    this.hitPoolPerVariant = Math.max(1, Math.round(hitPoolPerVariant))
    this.hitAutoPrefix = hitAutoPrefix
    this.hitAutoExtension = hitAutoExtension
    this.maxHitVariants = Math.max(1, Math.round(maxHitVariants))
    this.hitSfxUrlsOverride = Array.isArray(hitSfxUrls) ? hitSfxUrls.filter((sourceUrl) => Boolean(sourceUrl)) : []
    this.musicAudio = this._createAudio(musicUrl, musicVolume, true)

    this.hitAudioContext = null
    this.hitAudioBuffers = []
    this.hitBuffersLoadingPromise = null
    this.hitVariantUrls = []
    this.hitAssetsPrewarmPromise = null
    this.prewarmedHitAssets = []
    this.hitBurstSpacingMs = Math.max(8, Math.round(hitBurstSpacingMs))
    this.hitBurstMaxQueue = Math.max(1, Math.round(hitBurstMaxQueue))
    this.pendingHitBurstCount = 0
    this.hitBurstTimeoutId = null
    const fallbackHitUrl = `${this.hitAutoPrefix}1.${this.hitAutoExtension}`
    const initialHitUrl = this.hitSfxUrlsOverride[0] ?? fallbackHitUrl
    this.hitFallbackPool = this._createHitFallbackPool(initialHitUrl, this.hitVolume, this.hitPoolPerVariant)
    this.hitFallbackCursor = 0
    this._startHitAssetsPrewarm()
  }

  /**
   * Update runtime volumes from 0..100 slider values.
   * @param {number} musicVolumePercent
   * @param {number} hitVolumePercent
   * @returns {void}
   */
  setVolumesFromPercent(musicVolumePercent, hitVolumePercent) {
    const nextMusicVolume = _clampVolume(Number(musicVolumePercent) / 100)
    const nextHitVolume = _clampVolume(Number(hitVolumePercent) / 100)
    this.musicAudio.volume = nextMusicVolume
    this.hitVolume = nextHitVolume

    for (const audioInstance of this.hitFallbackPool) {
      audioInstance.volume = nextHitVolume
    }
  }

  /**
   * Register one-shot user interaction listeners to unlock audio playback.
   * @param {Window | HTMLElement} target
   * @returns {void}
   */
  attachUnlockListeners(target = window) {
    if (this._unlockTarget) {
      return
    }

    this._unlockTarget = target
    this._unlockTarget.addEventListener("pointerdown", this._onUnlockInteraction)
    this._unlockTarget.addEventListener("keydown", this._onUnlockInteraction)
    this._unlockTarget.addEventListener("touchstart", this._onUnlockInteraction, { passive: true })
  }

  /**
   * Notify the system that a direct user gesture happened.
   * @returns {void}
   */
  notifyUserGesture() {
    this._onUnlockInteraction()
  }

  /**
   * Try to start music immediately when entering non-interactive states like demo mode.
   * @returns {void}
   */
  requestMusicStart() {
    this._startMusicPlaybackWithRetry()
  }

  /**
   * Play one hit SFX instance.
   * @returns {void}
   */
  playHitSound() {
    if (!this._hasUnlocked) {
      this.notifyUserGesture()
    }

    if (!this._hasUnlocked) {
      return
    }

    this._enqueueHitSoundPlayback()
  }

  /**
   * Cleanup listeners and audio elements.
   * @returns {void}
   */
  dispose() {
    if (this._unlockTarget) {
      this._unlockTarget.removeEventListener("pointerdown", this._onUnlockInteraction)
      this._unlockTarget.removeEventListener("keydown", this._onUnlockInteraction)
      this._unlockTarget.removeEventListener("touchstart", this._onUnlockInteraction)
      this._unlockTarget = null
    }

    this.musicAudio.pause()
    this.musicAudio.src = ""
    for (const audioInstance of this.hitFallbackPool) {
      audioInstance.pause()
      audioInstance.src = ""
    }

    if (this.hitBurstTimeoutId !== null) {
      clearTimeout(this.hitBurstTimeoutId)
      this.hitBurstTimeoutId = null
    }
    this.pendingHitBurstCount = 0

    if (this.hitAudioContext) {
      this.hitAudioContext.close().catch(() => {})
      this.hitAudioContext = null
    }
  }

  /**
   * Handle the first interaction that allows audio playback.
   * @returns {void}
   */
  _onUnlockInteraction() {
    if (this._isMusicStarted) {
      return
    }

    this._hasUnlocked = true
    this._ensureHitAudioContext()
    this._startHitBuffersLoading()
    this._startMusicPlaybackWithRetry()
  }

  /**
   * Try to start background music and keep unlock listeners until success.
   * @returns {void}
   */
  _startMusicPlaybackWithRetry() {
    this.musicAudio.play()
      .then(() => {
        this._isMusicStarted = true
        if (this._unlockTarget) {
          this._unlockTarget.removeEventListener("pointerdown", this._onUnlockInteraction)
          this._unlockTarget.removeEventListener("keydown", this._onUnlockInteraction)
          this._unlockTarget.removeEventListener("touchstart", this._onUnlockInteraction)
          this._unlockTarget = null
        }
      })
      .catch(() => {})
  }

  /**
   * Play one low-latency hit SFX through Web Audio API.
   * @returns {void}
   */
  _playBufferedHitSound() {
    const variantIndex = Math.floor(Math.random() * this.hitAudioBuffers.length)
    const selectedBuffer = this.hitAudioBuffers[variantIndex]
    if (!selectedBuffer) {
      return
    }

    const sourceNode = this.hitAudioContext.createBufferSource()
    const gainNode = this.hitAudioContext.createGain()
    sourceNode.buffer = selectedBuffer
    gainNode.gain.value = this.hitVolume
    sourceNode.connect(gainNode)
    gainNode.connect(this.hitAudioContext.destination)
    sourceNode.start(0)
  }

  /**
   * Play one fallback hit SFX through HTMLAudio while buffers are not ready.
   * @returns {void}
   */
  _playFallbackHitSound() {
    if (this.hitFallbackPool.length === 0) {
      return
    }

    const nextAudioIndex = this._getNextFallbackAudioIndex()
    const audioInstance = this.hitFallbackPool[nextAudioIndex]
    this.hitFallbackCursor = (nextAudioIndex + 1) % this.hitFallbackPool.length
    audioInstance.currentTime = 0
    audioInstance.play().catch(() => {})
  }

  /**
   * Queue hit playback to preserve audibility during rapid bursts.
   * @returns {void}
   */
  _enqueueHitSoundPlayback() {
    this.pendingHitBurstCount = Math.min(this.hitBurstMaxQueue, this.pendingHitBurstCount + 1)
    if (this.hitBurstTimeoutId !== null) {
      return
    }

    this._drainHitSoundQueue()
  }

  /**
   * Play queued hit sounds with short spacing to avoid full overlap.
   * @returns {void}
   */
  _drainHitSoundQueue() {
    if (this.pendingHitBurstCount <= 0) {
      this.hitBurstTimeoutId = null
      return
    }

    this.pendingHitBurstCount -= 1
    this._playSingleHitSoundNow()

    if (this.pendingHitBurstCount <= 0) {
      this.hitBurstTimeoutId = null
      return
    }

    this.hitBurstTimeoutId = setTimeout(() => {
      this._drainHitSoundQueue()
    }, this.hitBurstSpacingMs)
  }

  /**
   * Play one hit immediately using buffered or fallback path.
   * @returns {void}
   */
  _playSingleHitSoundNow() {
    if (this._isBufferedHitPlaybackReady()) {
      this._playBufferedHitSound()
      return
    }

    this._playFallbackHitSound()
  }

  /**
   * Check if Web Audio playback can be used right now.
   * @returns {boolean}
   */
  _isBufferedHitPlaybackReady() {
    if (!this.hitAudioContext || this.hitAudioBuffers.length <= 0) {
      return false
    }

    if (this.hitAudioContext.state === "running") {
      return true
    }

    if (this.hitAudioContext.state === "suspended") {
      this.hitAudioContext.resume().catch(() => {})
    }
    return false
  }

  /**
   * Find fallback audio index that is currently paused, else use round-robin.
   * @returns {number}
   */
  _getNextFallbackAudioIndex() {
    if (this.hitFallbackPool.length <= 0) {
      return 0
    }

    for (let offset = 0; offset < this.hitFallbackPool.length; offset += 1) {
      const candidateIndex = (this.hitFallbackCursor + offset) % this.hitFallbackPool.length
      const candidateAudio = this.hitFallbackPool[candidateIndex]
      if (!candidateAudio || candidateAudio.paused || candidateAudio.ended) {
        return candidateIndex
      }
    }

    return this.hitFallbackCursor
  }

  /**
   * Build one audio element.
   * @param {string} sourceUrl
   * @param {number} volume
   * @param {boolean} loop
   * @returns {HTMLAudioElement}
   */
  _createAudio(sourceUrl, volume, loop) {
    const audioInstance = new Audio(sourceUrl)
    audioInstance.preload = "auto"
    audioInstance.loop = loop
    audioInstance.volume = _clampVolume(volume)
    return audioInstance
  }

  /**
   * Create a fallback pool for overlapping HTMLAudio hit SFX.
   * @param {string} sourceUrl
   * @param {number} volume
   * @param {number} poolSize
   * @returns {HTMLAudioElement[]}
   */
  _createHitFallbackPool(sourceUrl, volume, poolSize) {
    const safePoolSize = Math.max(1, Math.round(poolSize))
    const result = []
    for (let index = 0; index < safePoolSize; index += 1) {
      result.push(this._createAudio(sourceUrl, volume, false))
    }
    return result
  }

  /**
   * Initialize Web Audio context for low-latency hit playback.
   * @returns {void}
   */
  _ensureHitAudioContext() {
    if (this.hitAudioContext) {
      if (this.hitAudioContext.state === "suspended") {
        this.hitAudioContext.resume().catch(() => {})
      }
      return
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextConstructor) {
      return
    }

    this.hitAudioContext = new AudioContextConstructor()
    if (this.hitAudioContext.state === "suspended") {
      this.hitAudioContext.resume().catch(() => {})
    }
  }

  /**
   * Start asynchronous loading of auto-detected hit audio buffers.
   * @returns {void}
   */
  _startHitBuffersLoading() {
    if (!this.hitAudioContext) {
      return
    }

    if (this.hitBuffersLoadingPromise) {
      return
    }

    this.hitBuffersLoadingPromise = this._loadHitBuffers()
      .then((loadedBuffers) => {
        if (loadedBuffers.length > 0) {
          this.hitAudioBuffers = loadedBuffers
        }
      })
      .catch(() => {})
  }

  /**
   * Load and decode hit variant files.
   * @returns {Promise<AudioBuffer[]>}
   */
  async _loadHitBuffers() {
    await this._startHitAssetsPrewarm()
    const variantUrls = this.hitVariantUrls.length > 0
      ? this.hitVariantUrls
      : this.hitSfxUrlsOverride.length > 0
        ? this.hitSfxUrlsOverride
        : await this._detectAutoHitUrls()
    const decodedBuffers = []
    if (this.prewarmedHitAssets.length > 0) {
      for (const asset of this.prewarmedHitAssets) {
        const decodedBuffer = await this._decodeAudioArrayBuffer(asset.arrayBuffer)
        if (decodedBuffer) {
          decodedBuffers.push(decodedBuffer)
        }
      }
      if (decodedBuffers.length > 0) {
        return decodedBuffers
      }
    }

    for (const sourceUrl of variantUrls) {
      const decodedBuffer = await this._fetchAndDecodeAudioBuffer(sourceUrl)
      if (decodedBuffer) {
        decodedBuffers.push(decodedBuffer)
      }
    }
    return decodedBuffers
  }

  /**
   * Start prewarm of hit files at startup.
   * @returns {Promise<void>}
   */
  async _startHitAssetsPrewarm() {
    if (this.hitAssetsPrewarmPromise) {
      return this.hitAssetsPrewarmPromise
    }

    this.hitAssetsPrewarmPromise = this._prewarmHitAssets()
      .catch(() => {})
      .then(() => {})
    return this.hitAssetsPrewarmPromise
  }

  /**
   * Resolve hit variant URLs and fetch their binary data.
   * @returns {Promise<void>}
   */
  async _prewarmHitAssets() {
    const variantUrls = this.hitSfxUrlsOverride.length > 0 ? this.hitSfxUrlsOverride : await this._detectAutoHitUrls()
    this.hitVariantUrls = variantUrls
    const assets = []
    for (const sourceUrl of variantUrls) {
      const arrayBuffer = await _fetchAudioArrayBuffer(sourceUrl)
      if (!arrayBuffer) {
        continue
      }
      assets.push({
        sourceUrl,
        arrayBuffer
      })
    }
    this.prewarmedHitAssets = assets
  }

  /**
   * Detect available slap files using numeric suffix naming.
   * @returns {Promise<string[]>}
   */
  async _detectAutoHitUrls() {
    const candidateUrls = []
    for (let index = 1; index <= this.maxHitVariants; index += 1) {
      candidateUrls.push(`${this.hitAutoPrefix}${index}.${this.hitAutoExtension}`)
    }

    const existenceMap = await Promise.all(candidateUrls.map((sourceUrl) => _doesAudioAssetExist(sourceUrl)))
    const detectedUrls = candidateUrls.filter((_, index) => existenceMap[index])
    if (detectedUrls.length > 0) {
      return detectedUrls
    }

    const fallbackHitUrl = `${this.hitAutoPrefix}1.${this.hitAutoExtension}`
    return [fallbackHitUrl]
  }

  /**
   * Download and decode one audio file into a Web Audio buffer.
   * @param {string} sourceUrl
   * @returns {Promise<AudioBuffer | null>}
   */
  async _fetchAndDecodeAudioBuffer(sourceUrl) {
    if (!this.hitAudioContext) {
      return null
    }

    try {
      const response = await fetch(sourceUrl, { cache: "force-cache" })
      if (!response.ok) {
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      return await this._decodeAudioArrayBuffer(arrayBuffer)
    } catch (error) {
      return null
    }
  }

  /**
   * Decode one ArrayBuffer into an AudioBuffer.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<AudioBuffer | null>}
   */
  async _decodeAudioArrayBuffer(arrayBuffer) {
    if (!this.hitAudioContext) {
      return null
    }

    try {
      const cloneBuffer = arrayBuffer.slice(0)
      const decodedBuffer = await this.hitAudioContext.decodeAudioData(cloneBuffer)
      return decodedBuffer
    } catch (error) {
      return null
    }
  }
}

/**
 * Clamp volume to browser-accepted bounds.
 * @param {number} volume
 * @returns {number}
 */
function _clampVolume(volume) {
  return Math.min(1, Math.max(0, Number(volume) || 0))
}

/**
 * Check if one audio asset exists on current host.
 * @param {string} sourceUrl
 * @returns {Promise<boolean>}
 */
async function _doesAudioAssetExist(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      method: "HEAD",
      cache: "no-store"
    })
    return response.ok
  } catch (error) {
    return false
  }
}

/**
 * Download one audio file as binary buffer.
 * @param {string} sourceUrl
 * @returns {Promise<ArrayBuffer | null>}
 */
async function _fetchAudioArrayBuffer(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, { cache: "force-cache" })
    if (!response.ok) {
      return null
    }
    return await response.arrayBuffer()
  } catch (error) {
    return null
  }
}
