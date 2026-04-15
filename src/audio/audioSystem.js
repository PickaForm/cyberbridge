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
   * @param {string} options.hitSfxUrl
   * @param {number} options.musicVolume
   * @param {number} options.hitVolume
   * @param {number} options.hitBurstSpacingMs
   * @param {number} options.hitBurstMaxQueue
   */
  constructor(options = {}) {
    const {
      musicUrl = "/audio/music.mp3",
      hitSfxUrl = "/audio/sfx-npc-hit.wav",
      musicVolume = 0.26,
      hitVolume = 0.9,
      hitBurstSpacingMs = 28,
      hitBurstMaxQueue = 64
    } = options

    this._unlockTarget = null
    this._hasUnlocked = false
    this._isMusicStarted = false
    this._didLogAutoplayBlock = false
    this._musicStartRequested = false
    this._onUnlockInteraction = this._onUnlockInteraction.bind(this)
    this.hitVolume = _clampVolume(hitVolume)
    this.hitSfxUrl = hitSfxUrl
    this.musicAudio = this._createAudio(musicUrl, musicVolume, true)
    this.hitFallbackAudio = this._createAudio(this.hitSfxUrl, this.hitVolume, false)

    this.hitAudioContext = null
    this.hitAudioBuffer = null
    this.preloadedHitArrayBuffer = null
    this.hitAssetPreloadPromise = null
    this.hitBufferLoadingPromise = null
    this.hitBurstSpacingMs = Math.max(8, Math.round(hitBurstSpacingMs))
    this.hitBurstMaxQueue = Math.max(1, Math.round(hitBurstMaxQueue))
    this.pendingHitBurstCount = 0
    this.hitBurstTimeoutId = null
    this._startHitAssetPreload()
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
    this.hitFallbackAudio.volume = nextHitVolume
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
   * @param {Event | null} event
   * @returns {void}
   */
  notifyUserGesture(event = null) {
    this._onUnlockInteraction(event)
  }

  /**
   * Try to start music immediately when entering non-interactive states like demo mode.
   * @returns {void}
   */
  requestMusicStart() {
    this._musicStartRequested = true
    this._startMusicPlaybackWithRetry(false)
  }

  /**
   * Play one hit SFX instance.
   * @returns {void}
   */
  playHitSound() {
    if (!this._hasUnlocked && !this._isMusicStarted) {
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
    this.hitFallbackAudio.pause()
    this.hitFallbackAudio.src = ""

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
   * @param {Event | null} event
   * @returns {void}
   */
  _onUnlockInteraction(event = null) {
    if (!this._isTrustedUserEvent(event) && !this._hasUnlocked) {
      return
    }

    this._ensureHitAudioContext()
    this._startHitBufferLoading()
    if (this.hitAudioContext && this.hitAudioContext.state === "running") {
      this._hasUnlocked = true
    }

    if (this._musicStartRequested || !this._isMusicStarted) {
      this._startMusicPlaybackWithRetry(this._isTrustedUserEvent(event))
    }
  }

  /**
   * Try to start background music and keep unlock listeners until success.
   * @param {boolean} shouldLogFailure
   * @returns {void}
   */
  _startMusicPlaybackWithRetry(shouldLogFailure) {
    if (this._isMusicStarted) {
      return
    }

    this.musicAudio.play()
      .then(() => {
        this._hasUnlocked = true
        this._isMusicStarted = true
        this._didLogAutoplayBlock = false
        if (this._unlockTarget) {
          this._unlockTarget.removeEventListener("pointerdown", this._onUnlockInteraction)
          this._unlockTarget.removeEventListener("keydown", this._onUnlockInteraction)
          this._unlockTarget.removeEventListener("touchstart", this._onUnlockInteraction)
          this._unlockTarget = null
        }
      })
      .catch((error) => {
        if (!shouldLogFailure || this._didLogAutoplayBlock) {
          return
        }

        this._didLogAutoplayBlock = true
        const errorName = String(error?.name || "unknown")
        console.info(`Music autoplay blocked until user gesture (${errorName})`)
      })
  }

  /**
   * Check if event is a trusted browser user interaction.
   * @param {Event | null} event
   * @returns {boolean}
   */
  _isTrustedUserEvent(event) {
    return Boolean(event && event.isTrusted)
  }

  /**
   * Play one low-latency hit SFX through Web Audio API.
   * @returns {void}
   */
  _playBufferedHitSound() {
    if (!this.hitAudioContext || !this.hitAudioBuffer) {
      return
    }

    const sourceNode = this.hitAudioContext.createBufferSource()
    const gainNode = this.hitAudioContext.createGain()
    sourceNode.buffer = this.hitAudioBuffer
    gainNode.gain.value = this.hitVolume
    sourceNode.connect(gainNode)
    gainNode.connect(this.hitAudioContext.destination)
    sourceNode.start(0)
  }

  /**
   * Play one fallback hit SFX through HTMLAudio while buffer is not ready.
   * @returns {void}
   */
  _playFallbackHitSound() {
    this.hitFallbackAudio.currentTime = 0
    this.hitFallbackAudio.play().catch(() => {})
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
    if (!this.hitAudioContext || !this.hitAudioBuffer) {
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
   * Start asynchronous loading of the hit audio buffer.
   * @returns {void}
   */
  _startHitBufferLoading() {
    if (!this.hitAudioContext) {
      return
    }

    if (this.hitBufferLoadingPromise) {
      return
    }

    this.hitBufferLoadingPromise = this._loadHitBuffer()
      .then((decodedBuffer) => {
        if (decodedBuffer) {
          this.hitAudioBuffer = decodedBuffer
        }
      })
      .catch(() => {})
  }

  /**
   * Load and decode the configured hit file.
   * @returns {Promise<AudioBuffer | null>}
   */
  async _loadHitBuffer() {
    await this._startHitAssetPreload()
    if (this.preloadedHitArrayBuffer) {
      const preloadedClone = this.preloadedHitArrayBuffer.slice(0)
      return await this._decodeAudioArrayBuffer(preloadedClone)
    }
    return await this._fetchAndDecodeAudioBuffer(this.hitSfxUrl)
  }

  /**
   * Start hit file preloading at startup for faster first playback.
   * @returns {Promise<void>}
   */
  async _startHitAssetPreload() {
    if (this.hitAssetPreloadPromise) {
      return this.hitAssetPreloadPromise
    }

    this.hitAssetPreloadPromise = this._preloadHitAsset()
      .catch(() => {})
      .then(() => {})
    return this.hitAssetPreloadPromise
  }

  /**
   * Preload the hit file through HTMLAudio and fetch cache.
   * @returns {Promise<void>}
   */
  async _preloadHitAsset() {
    this.hitFallbackAudio.load()
    this.preloadedHitArrayBuffer = await _fetchAudioArrayBuffer(this.hitSfxUrl)
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
