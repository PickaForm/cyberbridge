/**
 * Developer palette overlay for tuning runtime parameters.
 *
 * Usage:
 * const palette = new DevPalette(tuningManager)
 */
export class DevPalette {
  /**
   * @param {object} tuningManager
   * @param {(profile: object) => void} onLiveProfileChange
   */
  constructor(tuningManager, onLiveProfileChange = null) {
    this.tuningManager = tuningManager
    this.onLiveProfileChange = onLiveProfileChange
    this.profile = tuningManager.getProfileClone()
    this.liveApplyTimeoutId = null
    this.sectionOrder = ["player", "crowd", "flyingCars", "buildings", "stands", "clouds", "sky"]
    this.sectionLabels = {
      player: "player",
      crowd: "crowd",
      flyingCars: "flying cars",
      buildings: "buildings",
      stands: "stands",
      clouds: "clouds",
      sky: "sky"
    }
    this.sectionStateStorageKey = "cyberlove-dev-palette-sections-v1"
    this.sectionState = this._loadSectionState()
    this.rootElement = this._createRootElement()
    this._renderSections()
    this._renderActions()
    document.body.appendChild(this.rootElement)
  }

  /**
   * Remove palette DOM.
   * @returns {void}
   */
  dispose() {
    if (this.liveApplyTimeoutId !== null) {
      clearTimeout(this.liveApplyTimeoutId)
      this.liveApplyTimeoutId = null
    }
    if (this.rootElement?.parentElement) {
      this.rootElement.parentElement.removeChild(this.rootElement)
    }
  }

  /**
   * Create root palette element.
   * @returns {HTMLElement}
   * @private
   * @ignore
   */
  _createRootElement() {
    const rootElement = document.createElement("div")
    rootElement.id = "devPalette"

    const closeButton = document.createElement("button")
    closeButton.type = "button"
    closeButton.className = "dev-palette-close"
    closeButton.setAttribute("aria-label", "Fermer la palette")
    closeButton.textContent = "×"
    closeButton.addEventListener("click", () => {
      rootElement.style.display = "none"
    })
    rootElement.appendChild(closeButton)

    const titleElement = document.createElement("div")
    titleElement.className = "dev-palette-title"
    titleElement.textContent = "Dev Palette"
    rootElement.appendChild(titleElement)

    const hintElement = document.createElement("p")
    hintElement.className = "dev-palette-hint"
    hintElement.textContent = "Ajuste les valeurs puis Save pour recharger le rendu."
    rootElement.appendChild(hintElement)

    return rootElement
  }

  /**
   * Render all expandable sections.
   * @returns {void}
   * @private
   * @ignore
   */
  _renderSections() {
    for (const sectionKey of this.sectionOrder) {
      const sectionData = this.profile[sectionKey]
      if (!sectionData) {
        continue
      }

      const detailsElement = document.createElement("details")
      detailsElement.className = "dev-palette-section"
      detailsElement.open = this._isSectionOpen(sectionKey)
      detailsElement.addEventListener("toggle", () => {
        this.sectionState[sectionKey] = detailsElement.open
        this._saveSectionState()
      })

      const summaryElement = document.createElement("summary")
      summaryElement.textContent = this.sectionLabels[sectionKey] ?? sectionKey
      detailsElement.appendChild(summaryElement)

      const sectionBodyElement = document.createElement("div")
      sectionBodyElement.className = "dev-palette-section-body"

      for (const [paramKey, paramSchema] of Object.entries(sectionData)) {
        sectionBodyElement.appendChild(this._createParamRow(sectionKey, paramKey, paramSchema))
      }

      detailsElement.appendChild(sectionBodyElement)
      this.rootElement.appendChild(detailsElement)
    }
  }

  /**
   * Render bottom action buttons.
   * @returns {void}
   * @private
   * @ignore
   */
  _renderActions() {
    const actionsElement = document.createElement("div")
    actionsElement.className = "dev-palette-actions"

    const saveButton = document.createElement("button")
    saveButton.type = "button"
    saveButton.className = "dev-palette-btn dev-palette-btn-save"
    saveButton.textContent = "Save"
    saveButton.addEventListener("click", () => {
      this.tuningManager.saveAndRestart(this.profile)
    })

    const resetButton = document.createElement("button")
    resetButton.type = "button"
    resetButton.className = "dev-palette-btn dev-palette-btn-reset"
    resetButton.textContent = "Reset"
    resetButton.addEventListener("click", () => {
      this.tuningManager.resetAndRestart()
    })

    actionsElement.appendChild(saveButton)
    actionsElement.appendChild(resetButton)
    this.rootElement.appendChild(actionsElement)
  }

  /**
   * Create one parameter row.
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {object} paramSchema
   * @returns {HTMLElement}
   * @private
   * @ignore
   */
  _createParamRow(sectionKey, paramKey, paramSchema) {
    const rowElement = document.createElement("div")
    rowElement.className = "dev-palette-row"

    const labelElement = document.createElement("label")
    labelElement.className = "dev-palette-label"
    labelElement.textContent = paramSchema.label ?? paramKey
    rowElement.appendChild(labelElement)

    const defaultElement = document.createElement("div")
    defaultElement.className = "dev-palette-default"
    defaultElement.textContent = `default: ${paramSchema.default}`
    rowElement.appendChild(defaultElement)

    const controlContainer = document.createElement("div")
    controlContainer.className = "dev-palette-control"
    rowElement.appendChild(controlContainer)

    if (paramSchema.type === "color") {
      this._appendColorControls(controlContainer, sectionKey, paramKey, paramSchema)
    } else if (paramSchema.type === "number") {
      this._appendNumberControls(controlContainer, sectionKey, paramKey, paramSchema)
    } else {
      this._appendTextControl(controlContainer, sectionKey, paramKey, paramSchema)
    }

    return rowElement
  }

  /**
   * Append color controls.
   * @param {HTMLElement} container
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {object} paramSchema
   * @returns {void}
   * @private
   * @ignore
   */
  _appendColorControls(container, sectionKey, paramKey, paramSchema) {
    const colorPicker = document.createElement("input")
    colorPicker.type = "color"
    colorPicker.value = `#${_normalizeHex(paramSchema.current, paramSchema.default)}`

    const textInput = document.createElement("input")
    textInput.type = "text"
    textInput.value = _normalizeHex(paramSchema.current, paramSchema.default)
    textInput.maxLength = 6
    textInput.spellcheck = false

    colorPicker.addEventListener("input", () => {
      const colorValue = colorPicker.value.replace(/^#/, "").toLowerCase()
      textInput.value = colorValue
      this._setParamValue(sectionKey, paramKey, colorValue)
      this._scheduleLiveApply()
    })

    textInput.addEventListener("input", () => {
      const normalizedHex = _normalizeHex(textInput.value, paramSchema.default)
      this._setParamValue(sectionKey, paramKey, normalizedHex)
      if (/^[0-9a-f]{6}$/.test(textInput.value.trim().replace(/^#/, "").toLowerCase())) {
        colorPicker.value = `#${normalizedHex}`
      }
      this._scheduleLiveApply()
    })

    container.appendChild(colorPicker)
    container.appendChild(textInput)
  }

  /**
   * Append number controls (slider + number field).
   * @param {HTMLElement} container
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {object} paramSchema
   * @returns {void}
   * @private
   * @ignore
   */
  _appendNumberControls(container, sectionKey, paramKey, paramSchema) {
    const sliderInput = document.createElement("input")
    sliderInput.type = "range"
    sliderInput.min = String(paramSchema.min ?? 0)
    sliderInput.max = String(paramSchema.max ?? 100)
    sliderInput.step = String(paramSchema.step ?? 0.01)
    sliderInput.value = String(paramSchema.current)

    const numberInput = document.createElement("input")
    numberInput.type = "number"
    numberInput.min = String(paramSchema.min ?? 0)
    numberInput.max = String(paramSchema.max ?? 100)
    numberInput.step = String(paramSchema.step ?? 0.01)
    numberInput.value = String(paramSchema.current)

    const syncValue = (rawValue) => {
      const numericValue = Number(rawValue)
      if (!Number.isFinite(numericValue)) {
        return
      }
      const min = Number(paramSchema.min ?? numericValue)
      const max = Number(paramSchema.max ?? numericValue)
      const clampedValue = Math.min(max, Math.max(min, numericValue))
      sliderInput.value = String(clampedValue)
      numberInput.value = String(clampedValue)
      this._setParamValue(sectionKey, paramKey, clampedValue)
      this._scheduleLiveApply()
    }

    sliderInput.addEventListener("input", () => {
      syncValue(sliderInput.value)
    })

    numberInput.addEventListener("input", () => {
      syncValue(numberInput.value)
    })

    container.appendChild(sliderInput)
    container.appendChild(numberInput)
  }

  /**
   * Append generic text control.
   * @param {HTMLElement} container
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {object} paramSchema
   * @returns {void}
   * @private
   * @ignore
   */
  _appendTextControl(container, sectionKey, paramKey, paramSchema) {
    const textInput = document.createElement("input")
    textInput.type = "text"
    textInput.value = String(paramSchema.current ?? "")
    textInput.addEventListener("input", () => {
      this._setParamValue(sectionKey, paramKey, textInput.value)
      this._scheduleLiveApply()
    })
    container.appendChild(textInput)
  }

  /**
   * Set one parameter current value and mirror it to default.
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {unknown} value
   * @returns {void}
   * @private
   * @ignore
   */
  _setParamValue(sectionKey, paramKey, value) {
    const section = this.profile?.[sectionKey]
    const parameter = section?.[paramKey]
    if (!parameter) {
      return
    }

    parameter.current = value
  }

  /**
   * Debounce live profile application for smooth slider updates.
   * @returns {void}
   * @private
   * @ignore
   */
  _scheduleLiveApply() {
    if (!this.onLiveProfileChange) {
      return
    }

    if (this.liveApplyTimeoutId !== null) {
      clearTimeout(this.liveApplyTimeoutId)
    }

    this.liveApplyTimeoutId = window.setTimeout(() => {
      this.liveApplyTimeoutId = null
      this.onLiveProfileChange(this.profile)
    }, 90)
  }

  /**
   * Read persisted open/closed state for palette sections.
   * @returns {Record<string, boolean>}
   * @private
   * @ignore
   */
  _loadSectionState() {
    try {
      const rawValue = window.localStorage.getItem(this.sectionStateStorageKey)
      if (!rawValue) {
        return {}
      }

      const parsedValue = JSON.parse(rawValue)
      if (!parsedValue || typeof parsedValue !== "object") {
        return {}
      }

      const result = {}
      for (const sectionKey of this.sectionOrder) {
        if (typeof parsedValue[sectionKey] === "boolean") {
          result[sectionKey] = parsedValue[sectionKey]
        }
      }

      return result
    } catch (error) {
      console.warn("Failed to read dev palette section state", error)
      return {}
    }
  }

  /**
   * Persist open/closed state for palette sections.
   * @returns {void}
   * @private
   * @ignore
   */
  _saveSectionState() {
    try {
      window.localStorage.setItem(this.sectionStateStorageKey, JSON.stringify(this.sectionState))
    } catch (error) {
      console.warn("Failed to persist dev palette section state", error)
    }
  }

  /**
   * Resolve if a section should start opened.
   * @param {string} sectionKey
   * @returns {boolean}
   * @private
   * @ignore
   */
  _isSectionOpen(sectionKey) {
    if (typeof this.sectionState[sectionKey] === "boolean") {
      return this.sectionState[sectionKey]
    }
    return sectionKey === "player"
  }
}

/**
 * Normalize a hex color string.
 * @param {unknown} value
 * @param {unknown} fallbackValue
 * @returns {string}
 * @private
 * @ignore
 */
function _normalizeHex(value, fallbackValue) {
  const fallbackHex = _normalizeRawHex(String(fallbackValue ?? "ffffff"))
  const currentHex = _normalizeRawHex(String(value ?? ""))
  return currentHex ?? fallbackHex ?? "ffffff"
}

/**
 * Normalize raw input to 6-char hex.
 * @param {string} value
 * @returns {string | null}
 * @private
 * @ignore
 */
function _normalizeRawHex(value) {
  const cleanedHex = value.trim().replace(/^#/, "").toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(cleanedHex)) {
    return null
  }
  return cleanedHex
}
