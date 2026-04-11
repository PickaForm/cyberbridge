/**
 * Developer palette overlay for tuning runtime parameters.
 *
 * Usage:
 * const palette = new DevPalette(tuningManager)
 */
export class DevPalette {
  /**
   * @param {object} tuningManager
   * @param {{onLiveProfileChange?: ((profile: object) => void) | null, onCycleLevelRequest?: ((step: number) => object | void) | null, onLevelDefinitionRequest?: (() => object | null) | null, onSaveLevelRequest?: ((levelDefinition: object, profile: object) => void) | null}} callbacks
   */
  constructor(tuningManager, callbacks = {}) {
    const {
      onLiveProfileChange = null,
      onCycleLevelRequest = null,
      onLevelDefinitionRequest = null,
      onSaveLevelRequest = null
    } = callbacks
    this.tuningManager = tuningManager
    this.onLiveProfileChange = onLiveProfileChange
    this.onCycleLevelRequest = onCycleLevelRequest
    this.onLevelDefinitionRequest = onLevelDefinitionRequest
    this.onSaveLevelRequest = onSaveLevelRequest
    this.profile = tuningManager.getProfileClone()
    this.levelDefinition = this._normalizeLevelDefinition(this.onLevelDefinitionRequest?.() ?? null)
    this.liveApplyTimeoutId = null
    this.gameRulesSectionKey = "gameRules"
    this.sectionOrder = ["player", "crowd", "hit", "flyingCars", "buildings", "walkway", "stands", "clouds", "rain", "world", "sound", "demoMode"]
    this.sectionLabels = {
      player: "player",
      crowd: "crowd",
      hit: "hit",
      sound: "sound",
      flyingCars: "flying cars",
      buildings: "buildings",
      walkway: "walkway",
      stands: "stands",
      clouds: "clouds",
      rain: "rain",
      world: "world",
      demoMode: "DEMO MODE"
    }
    this.sectionStateStorageKey = "cyberlove-dev-palette-sections-v1"
    this.sectionState = this._loadSectionState()
    this.actionsElement = null
    this.rootElement = this._createRootElement()
    this._renderLevelTestControls()
    this._renderGameRulesSection()
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
   */
  _createRootElement() {
    const rootElement = document.createElement("div")
    rootElement.id = "devPalette"

    const topActionsElement = document.createElement("div")
    topActionsElement.className = "dev-palette-top-actions"

    const expandAllButton = this._createTopActionButton({
      className: "dev-palette-expand-all",
      ariaLabel: "Tout deplier les sections",
      textContent: "+",
      onClick: () => {
        this._toggleAllSections(true)
      }
    })
    topActionsElement.appendChild(expandAllButton)

    const collapseAllButton = this._createTopActionButton({
      className: "dev-palette-collapse-all",
      ariaLabel: "Tout replier les sections",
      textContent: "-",
      onClick: () => {
        this._toggleAllSections(false)
      }
    })
    topActionsElement.appendChild(collapseAllButton)

    const closeButton = document.createElement("button")
    closeButton.type = "button"
    closeButton.className = "dev-palette-close"
    closeButton.setAttribute("aria-label", "Fermer la palette")
    closeButton.textContent = "×"
    closeButton.addEventListener("click", () => {
      rootElement.style.display = "none"
    })
    topActionsElement.appendChild(closeButton)
    rootElement.appendChild(topActionsElement)

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
   */
  _renderSections() {
    for (const sectionKey of this.sectionOrder) {
      let sectionData = this.profile[sectionKey]
      let paramSectionKey = sectionKey

      if (sectionKey === "buildings") {
        sectionData = this._extractBuildingsSectionWithoutWalkway(this.profile.buildings ?? {})
      } else if (sectionKey === "walkway") {
        sectionData = this._extractWalkwaySection(this.profile.buildings ?? {})
        paramSectionKey = "buildings"
      }

      if (!sectionData || Object.keys(sectionData).length <= 0) {
        continue
      }

      const detailsElement = document.createElement("details")
      detailsElement.className = "dev-palette-section"
      detailsElement.dataset.sectionKey = sectionKey
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
        sectionBodyElement.appendChild(this._createParamRow(paramSectionKey, paramKey, paramSchema))
      }

      detailsElement.appendChild(sectionBodyElement)
      this.rootElement.appendChild(detailsElement)
    }
  }

  /**
   * Extract buildings parameters except walkway-prefixed keys.
   * @param {object} buildingsSection
   * @returns {object}
   */
  _extractBuildingsSectionWithoutWalkway(buildingsSection) {
    const nextSection = {}
    for (const [paramKey, paramSchema] of Object.entries(buildingsSection)) {
      if (paramKey.startsWith("walkway")) {
        continue
      }
      nextSection[paramKey] = paramSchema
    }
    return nextSection
  }

  /**
   * Extract walkway-prefixed parameters from buildings section.
   * @param {object} buildingsSection
   * @returns {object}
   */
  _extractWalkwaySection(buildingsSection) {
    const nextSection = {}
    for (const [paramKey, paramSchema] of Object.entries(buildingsSection)) {
      if (!paramKey.startsWith("walkway")) {
        continue
      }
      nextSection[paramKey] = paramSchema
    }
    return nextSection
  }

  /**
   * Render bottom action buttons.
   * @returns {void}
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

    const saveLevelButton = document.createElement("button")
    saveLevelButton.type = "button"
    saveLevelButton.className = "dev-palette-btn dev-palette-btn-save"
    saveLevelButton.textContent = "Save level"
    saveLevelButton.addEventListener("click", () => {
      if (!this.onSaveLevelRequest) {
        return
      }
      this.onSaveLevelRequest(this._cloneValue(this.levelDefinition), this.profile)
    })

    actionsElement.appendChild(saveButton)
    actionsElement.appendChild(saveLevelButton)
    actionsElement.appendChild(resetButton)
    this.actionsElement = actionsElement
    this.rootElement.appendChild(actionsElement)
  }

  /**
   * Render level testing controls at the top of the palette.
   * @returns {void}
   */
  _renderLevelTestControls() {
    const levelTestRowElement = document.createElement("div")
    levelTestRowElement.className = "dev-palette-level-test"

    const previousButtonElement = document.createElement("button")
    previousButtonElement.type = "button"
    previousButtonElement.className = "dev-palette-btn dev-palette-level-test-btn"
    previousButtonElement.textContent = "Level précédent"
    previousButtonElement.addEventListener("click", () => {
      this._cycleLevel(-1)
    })

    const currentLevelElement = document.createElement("div")
    currentLevelElement.className = "dev-palette-level-current"
    this.currentLevelLabelElement = currentLevelElement
    this._renderCurrentLevelLabel()

    const nextButtonElement = document.createElement("button")
    nextButtonElement.type = "button"
    nextButtonElement.className = "dev-palette-btn dev-palette-level-test-btn"
    nextButtonElement.textContent = "Level suivant"
    nextButtonElement.addEventListener("click", () => {
      this._cycleLevel(1)
    })

    levelTestRowElement.appendChild(previousButtonElement)
    levelTestRowElement.appendChild(currentLevelElement)
    levelTestRowElement.appendChild(nextButtonElement)
    this.rootElement.appendChild(levelTestRowElement)
  }

  /**
   * Render editable game rules controls.
   * @returns {void}
   */
  _renderGameRulesSection() {
    const detailsElement = document.createElement("details")
    detailsElement.className = "dev-palette-section"
    detailsElement.dataset.sectionKey = this.gameRulesSectionKey
    detailsElement.open = this._isSectionOpen(this.gameRulesSectionKey)
    detailsElement.addEventListener("toggle", () => {
      this.sectionState[this.gameRulesSectionKey] = detailsElement.open
      this._saveSectionState()
    })

    const summaryElement = document.createElement("summary")
    summaryElement.textContent = "game rules"
    detailsElement.appendChild(summaryElement)

    const sectionBodyElement = document.createElement("div")
    sectionBodyElement.className = "dev-palette-section-body"
    detailsElement.appendChild(sectionBodyElement)
    this.gameRulesBodyElement = sectionBodyElement
    this._renderGameRulesRows()
    this.rootElement.appendChild(detailsElement)
  }

  /**
   * Build one top-right action button.
   * @param {{className: string, ariaLabel: string, textContent: string, onClick: (() => void)}} options
   * @returns {HTMLButtonElement}
   */
  _createTopActionButton(options) {
    const buttonElement = document.createElement("button")
    buttonElement.type = "button"
    buttonElement.className = `dev-palette-top-btn ${options.className}`
    buttonElement.setAttribute("aria-label", options.ariaLabel)
    buttonElement.textContent = options.textContent
    buttonElement.addEventListener("click", options.onClick)
    return buttonElement
  }

  /**
   * Expand or collapse all visible palette sections.
   * @param {boolean} shouldOpen
   * @returns {void}
   */
  _toggleAllSections(shouldOpen) {
    const sectionElements = this.rootElement.querySelectorAll("details.dev-palette-section")
    for (const sectionElement of sectionElements) {
      sectionElement.open = shouldOpen

      const sectionKey = sectionElement.dataset.sectionKey
      if (!sectionKey || !this.sectionOrder.includes(sectionKey)) {
        continue
      }
      this.sectionState[sectionKey] = shouldOpen
    }
    this._saveSectionState()
  }

  /**
   * Render game rules rows from current level definition.
   * @returns {void}
   */
  _renderGameRulesRows() {
    if (!this.gameRulesBodyElement) {
      return
    }

    this.gameRulesBodyElement.innerHTML = ""

    this._appendGameRuleNumberRow("id", "id", this.levelDefinition.id)
    this._appendGameRuleNumberRow("target.distance", "target distance", this.levelDefinition.target.distance)
    this._appendGameRuleNumberRow("target.chrono", "target chrono (ms)", this.levelDefinition.target.chrono)
    this._appendGameRuleNumberRow("target.score", "target score", this.levelDefinition.target.score)
    this._appendGameRuleNumberRow("target.boysHit", "target boys hit", this.levelDefinition.target.boysHit)
    this._appendGameRuleNumberRow("target.girlsHit", "target girls hit", this.levelDefinition.target.girlsHit)
    this._appendGameRuleNumberRow("lose.boysHit", "lose boys hit", this.levelDefinition.lose.boysHit)
    this._appendGameRuleNumberRow("lose.girlsHit", "lose girls hit", this.levelDefinition.lose.girlsHit)
    this._appendGameRuleTextRow("texts.objective", "objective text", this.levelDefinition.texts.objective)
    this._appendGameRuleTextRow("texts.win", "win text", this.levelDefinition.texts.win)
    this._appendGameRuleTextRow("texts.lose", "lose text", this.levelDefinition.texts.lose)
    this._appendGameRuleTextRow("texts.nextLevel", "next level text", this.levelDefinition.texts.nextLevel)
    this._appendGameRuleTextRow("texts.retry", "retry text", this.levelDefinition.texts.retry)
  }

  /**
   * Append one game rule numeric row.
   * @param {string} rulePath
   * @param {string} label
   * @param {number} value
   * @returns {void}
   */
  _appendGameRuleNumberRow(rulePath, label, value) {
    const rowElement = document.createElement("div")
    rowElement.className = "dev-palette-row"

    const labelElement = document.createElement("label")
    labelElement.className = "dev-palette-label"
    labelElement.textContent = label
    rowElement.appendChild(labelElement)

    const inputElement = document.createElement("input")
    inputElement.type = "number"
    inputElement.step = "1"
    inputElement.value = String(value)
    inputElement.addEventListener("input", () => {
      const numericValue = Math.max(0, Math.round(Number(inputElement.value) || 0))
      inputElement.value = String(numericValue)
      this._setGameRuleValue(rulePath, numericValue)
    })
    rowElement.appendChild(inputElement)
    this.gameRulesBodyElement.appendChild(rowElement)
  }

  /**
   * Append one game rule text row.
   * @param {string} rulePath
   * @param {string} label
   * @param {string} value
   * @returns {void}
   */
  _appendGameRuleTextRow(rulePath, label, value) {
    const rowElement = document.createElement("div")
    rowElement.className = "dev-palette-row"

    const labelElement = document.createElement("label")
    labelElement.className = "dev-palette-label"
    labelElement.textContent = label
    rowElement.appendChild(labelElement)

    const inputElement = document.createElement("input")
    inputElement.type = "text"
    inputElement.value = String(value ?? "")
    inputElement.addEventListener("input", () => {
      this._setGameRuleValue(rulePath, inputElement.value)
    })
    rowElement.appendChild(inputElement)
    this.gameRulesBodyElement.appendChild(rowElement)
  }

  /**
   * Cycle to previous/next level through callback.
   * @param {number} step
   * @returns {void}
   */
  _cycleLevel(step) {
    if (!this.onCycleLevelRequest) {
      return
    }

    const nextLevelDefinition = this.onCycleLevelRequest(step)
    if (nextLevelDefinition) {
      this._syncProfileWithRuntime()
      this._rerenderParamSectionsFromProfile()
      this.levelDefinition = this._normalizeLevelDefinition(nextLevelDefinition)
      this._renderCurrentLevelLabel()
      this._renderGameRulesRows()
    }
  }

  /**
   * Sync local palette profile with current runtime profile.
   * @returns {void}
   */
  _syncProfileWithRuntime() {
    this.profile = this.tuningManager.getProfileClone()
  }

  /**
   * Re-render parameter sections so controls reflect the current runtime profile.
   * @returns {void}
   */
  _rerenderParamSectionsFromProfile() {
    this._removeParamSections()

    if (this.actionsElement?.parentElement) {
      this.actionsElement.parentElement.removeChild(this.actionsElement)
    }

    this._renderSections()

    if (this.actionsElement) {
      this.rootElement.appendChild(this.actionsElement)
    }
  }

  /**
   * Remove all parameter sections (excluding game rules).
   * @returns {void}
   */
  _removeParamSections() {
    const sectionElements = this.rootElement.querySelectorAll("details.dev-palette-section")
    for (const sectionElement of sectionElements) {
      const sectionKey = sectionElement.dataset.sectionKey
      if (!sectionKey || !this.sectionOrder.includes(sectionKey)) {
        continue
      }

      sectionElement.remove()
    }
  }

  /**
   * Render the non-editable current level indicator.
   * @returns {void}
   */
  _renderCurrentLevelLabel() {
    if (!this.currentLevelLabelElement) {
      return
    }
    this.currentLevelLabelElement.textContent = `Level ${this.levelDefinition.id}`
  }

  /**
   * Create one parameter row.
   * @param {string} sectionKey
   * @param {string} paramKey
   * @param {object} paramSchema
   * @returns {HTMLElement}
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
   * Set one game-rule value by dotted path.
   * @param {string} rulePath
   * @param {unknown} value
   * @returns {void}
   */
  _setGameRuleValue(rulePath, value) {
    const pathSegments = rulePath.split(".")
    let currentObject = this.levelDefinition
    for (let segmentIndex = 0; segmentIndex < pathSegments.length - 1; segmentIndex += 1) {
      const segment = pathSegments[segmentIndex]
      if (!currentObject[segment] || typeof currentObject[segment] !== "object") {
        currentObject[segment] = {}
      }
      currentObject = currentObject[segment]
    }

    const targetKey = pathSegments[pathSegments.length - 1]
    currentObject[targetKey] = value
  }

  /**
   * Normalize one level definition shape used by game rules editor.
   * @param {object | null} levelDefinition
   * @returns {object}
   */
  _normalizeLevelDefinition(levelDefinition) {
    const sourceLevel = levelDefinition ?? {}
    const sourceTarget = sourceLevel.target ?? {}
    const sourceLose = sourceLevel.lose ?? {}
    const sourceTexts = sourceLevel.texts ?? {}

    return {
      id: Math.max(1, Math.round(Number(sourceLevel.id) || 1)),
      target: {
        distance: Math.max(0, Math.round(Number(sourceTarget.distance) || 0)),
        chrono: Math.max(0, Math.round(Number(sourceTarget.chrono) || 0)),
        score: Math.max(0, Math.round(Number(sourceTarget.score) || 0)),
        boysHit: Math.max(0, Math.round(Number(sourceTarget.boysHit) || 0)),
        girlsHit: Math.max(0, Math.round(Number(sourceTarget.girlsHit) || 0))
      },
      lose: {
        boysHit: Math.max(0, Math.round(Number(sourceLose.boysHit) || 0)),
        girlsHit: Math.max(0, Math.round(Number(sourceLose.girlsHit) || 0))
      },
      texts: {
        objective: String(sourceTexts.objective ?? ""),
        win: String(sourceTexts.win ?? ""),
        lose: String(sourceTexts.lose ?? ""),
        nextLevel: String(sourceTexts.nextLevel ?? ""),
        retry: String(sourceTexts.retry ?? "")
      },
      init: sourceLevel.init && typeof sourceLevel.init === "object" ? sourceLevel.init : {}
    }
  }

  /**
   * Deep clone JSON-compatible values.
   * @param {object} value
   * @returns {object}
   */
  _cloneValue(value) {
    return JSON.parse(JSON.stringify(value))
  }

  /**
   * Debounce live profile application for smooth slider updates.
   * @returns {void}
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
      if (typeof parsedValue[this.gameRulesSectionKey] === "boolean") {
        result[this.gameRulesSectionKey] = parsedValue[this.gameRulesSectionKey]
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
   */
  _isSectionOpen(sectionKey) {
    if (typeof this.sectionState[sectionKey] === "boolean") {
      return this.sectionState[sectionKey]
    }
    if (sectionKey === this.gameRulesSectionKey) {
      return true
    }
    return sectionKey === "player"
  }
}

/**
 * Normalize a hex color string.
 * @param {unknown} value
 * @param {unknown} fallbackValue
 * @returns {string}
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
 */
function _normalizeRawHex(value) {
  const cleanedHex = value.trim().replace(/^#/, "").toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(cleanedHex)) {
    return null
  }
  return cleanedHex
}
