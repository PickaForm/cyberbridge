/**
 * Render bootstrap for Cyberlove POC.
 *
 * Usage:
 * const rendererApp = new RendererApp(document.getElementById("app"))
 * rendererApp.render()
 */
import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { gameConfig } from "../config/gameConfig.js"
import { getRuntimeTuningColor } from "../config/tuningRuntime.js"
import { SkyRenderer } from "./skyRenderer.js"

export class RendererApp {
  /**
   * @param {HTMLElement} hostElement
   */
  constructor(hostElement) {
    this.hostElement = hostElement
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 2500)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", desynchronized: false })
    this.composer = null
    this.bloomPass = null
    this.skyRenderer = null
    this.ambientLight = null
    this.mainLight = null
    this.baseExposure = 1.05
    this.baseFogDensity = gameConfig.render.fogDensity
    this._onResize = this._onResize.bind(this)

    this._setupRenderer()
    this._setupScene()
    this._setupPostProcessing()
    this._setupEvents()
    this.applyRuntimeTuning()
  }

  /**
   * Get the render canvas to bind controls.
   * @returns {HTMLCanvasElement}
   */
  getDomElement() {
    return this.renderer.domElement
  }

  /**
   * Render one frame.
   * @returns {void}
   */
  render() {
    this.skyRenderer.update()
    this.composer.render()
  }

  /**
   * Apply runtime tuning updates to renderer-level systems.
   * @returns {void}
   */
  applyRuntimeTuning() {
    const skyProfile = this.skyRenderer.applyRuntimeTuning()
    this._applyRuntimeFogColor()
    this._applyDayNightRenderProfile(skyProfile)
    return skyProfile
  }

  /**
   * Get current sky day/night profile.
   * @returns {{daylightFactor: number, twilightFactor: number, starVisibility: number}}
   */
  getSkyProfile() {
    return this.skyRenderer.currentProfile
  }

  /**
   * Release renderer resources.
   * @returns {void}
   */
  dispose() {
    window.removeEventListener("resize", this._onResize)
    this.skyRenderer.dispose()
    this.renderer.dispose()
    this.composer.dispose()
  }

  /**
   * Initialize Three renderer.
   * @returns {void}
   */
  _setupRenderer() {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = this.baseExposure
    this.renderer.setClearColor(gameConfig.render.backgroundMidColor, 1)
    this.hostElement.appendChild(this.renderer.domElement)
  }

  /**
   * Initialize lights and atmosphere.
   * @returns {void}
   */
  _setupScene() {
    this.scene.fog = new THREE.FogExp2(gameConfig.render.fogColor, gameConfig.render.fogDensity)
    this.skyRenderer = new SkyRenderer(this.scene, this.camera)

    this.ambientLight = new THREE.AmbientLight(0x7090c8, 0.5)
    this.scene.add(this.ambientLight)

    this.mainLight = new THREE.DirectionalLight(0xaec5ff, 0.7)
    this.mainLight.position.set(12, 20, 7)
    this.scene.add(this.mainLight)

    const cyberLightA = new THREE.PointLight(0x22e6ff, 4.5, 120, 2)
    cyberLightA.position.set(0, 8, 12)
    this.scene.add(cyberLightA)

    const cyberLightB = new THREE.PointLight(0xff2ea6, 2.8, 90, 2)
    cyberLightB.position.set(-8, 10, -14)
    this.scene.add(cyberLightB)
  }

  /**
   * Initialize bloom post-processing.
   * @returns {void}
   */
  _setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      gameConfig.render.bloomStrength,
      gameConfig.render.bloomRadius,
      gameConfig.render.bloomThreshold
    )
    this.composer.addPass(this.bloomPass)
  }

  /**
   * Register browser events.
   * @returns {void}
   */
  _setupEvents() {
    window.addEventListener("resize", this._onResize)
  }

  /**
   * Handle viewport resize.
   * @returns {void}
   */
  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
  }

  /**
   * Prevent overexposure at sunrise/day while keeping cyber glow at night.
   * @param {{daylightFactor: number, twilightFactor: number, starVisibility: number} | undefined} skyProfile
   * @returns {void}
   */
  _applyDayNightRenderProfile(skyProfile) {
    const daylightFactor = THREE.MathUtils.clamp(skyProfile?.daylightFactor ?? 0, 0, 1)
    const nightToDayBlend = THREE.MathUtils.smoothstep(daylightFactor, 0, 1)
    this.renderer.toneMappingExposure = this.baseExposure

    if (this.bloomPass) {
      this.bloomPass.strength = gameConfig.render.bloomStrength
      this.bloomPass.threshold = gameConfig.render.bloomThreshold
      this.bloomPass.radius = gameConfig.render.bloomRadius
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = 0.42 + nightToDayBlend * 0.16
      this.ambientLight.color.setHex(0x6a88b8).lerp(new THREE.Color(0x9db8d4), nightToDayBlend)
    }

    if (this.mainLight) {
      this.mainLight.intensity = 0.58 + nightToDayBlend * 0.26
      this.mainLight.color.setHex(0x8fb4ff).lerp(new THREE.Color(0xd9e7ff), nightToDayBlend)
    }
  }

  /**
   * Apply runtime fog color override from dev tuning profile.
   * @returns {void}
   */
  _applyRuntimeFogColor() {
    const runtimeFogColor = getRuntimeTuningColor("world.fogColor", gameConfig.render.fogColor)
    if (!this.scene.fog || !("color" in this.scene.fog) || !this.scene.fog.color) {
      return
    }

    this.scene.fog.color.setHex(runtimeFogColor)
  }

}
