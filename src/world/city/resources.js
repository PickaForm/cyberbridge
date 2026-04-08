/**
 * Shared city rendering resources for procedural generation.
 *
 * Usage:
 * import { createCityResources } from "./city/resources.js"
 * const resources = createCityResources()
 */
import * as THREE from "three"
import { gameConfig } from "../../config/gameConfig.js"
import { getRuntimeTuningColor, getRuntimeTuningNumber } from "../../config/tuningRuntime.js"

/**
 * Create and return all shared resources for city generation.
 * @returns {object}
 */
export function createCityResources() {
  const textures = _createTextures()
  const materials = _createMaterials(textures)
  const geometries = _createGeometries()
  const sharedGeometries = new Set(Object.values(geometries))
  const palettes = _createPalettes(materials)

  return {
    textures,
    materials,
    geometries,
    sharedGeometries,
    palettes
  }
}

/**
 * Dispose shared geometries and materials.
 * @param {object} resources
 * @returns {void}
 */
export function disposeCityResources(resources) {
  for (const geometry of Object.values(resources.geometries)) {
    geometry.dispose()
  }

  for (const texture of Object.values(resources.textures)) {
    texture.dispose()
  }

  const uniqueMaterials = new Set(Object.values(resources.materials))
  for (const material of uniqueMaterials) {
    material.dispose()
  }
}

/**
 * Build procedural textures used by city rendering.
 * @returns {Record<string, THREE.Texture>}
 */
function _createTextures() {
  return {
    cloudSoft: _createCloudTexture(256)
  }
}

/**
 * Build shared material instances.
 * @returns {Record<string, THREE.Material>}
 */
function _createMaterials(textures) {
  const walkwayColorHex = getRuntimeTuningColor(
    "world.walkwayColor",
    getRuntimeTuningColor("buildings.walkwayColor", 0x98a4b5)
  )
  const walkwayColor = new THREE.Color(walkwayColorHex)
  const walkwayEmissive = walkwayColor.clone().multiplyScalar(0.22).lerp(new THREE.Color(0x10121a), 0.25)
  const guardrailColor = walkwayColor.clone().lerp(new THREE.Color(0xffffff), 0.16)
  const guardrailEmissive = walkwayColor.clone().multiplyScalar(1.35)
  const buildingBaseColorHex = getRuntimeTuningColor(
    "world.buildingBaseColor",
    getRuntimeTuningColor("buildings.baseColor", 0x101723)
  )
  const buildingBaseColor = new THREE.Color(buildingBaseColorHex)
  const buildingBaseEmissive = buildingBaseColor.clone().multiplyScalar(0.42).lerp(new THREE.Color(0x060b14), 0.55)

  const materials = {
    walkway: new THREE.MeshStandardMaterial({
      color: walkwayColor,
      emissive: walkwayEmissive,
      emissiveIntensity: 0.72,
      roughness: 0.55,
      metalness: 0.32
    }),
    ground: new THREE.MeshStandardMaterial({
      color: getRuntimeTuningColor("world.groundColor", 0x1a2436),
      emissive: 0x060a11,
      emissiveIntensity: 0.3,
      roughness: 0.88,
      metalness: 0.06
    }),
    guardrail: new THREE.MeshStandardMaterial({
      color: guardrailColor,
      emissive: guardrailEmissive,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.65
    }),
    buildingBase: new THREE.MeshStandardMaterial({
      color: buildingBaseColor,
      emissive: buildingBaseEmissive,
      roughness: 0.7,
      metalness: 0.2
    }),
    neonA: new THREE.MeshStandardMaterial({
      color: 0x17d5ff,
      emissive: 0x17d5ff,
      emissiveIntensity: 2.3,
      roughness: 0.2,
      metalness: 0.7
    }),
    neonB: new THREE.MeshStandardMaterial({
      color: 0xff3db5,
      emissive: 0xff3db5,
      emissiveIntensity: 2.25,
      roughness: 0.25,
      metalness: 0.7
    }),
    neonC: new THREE.MeshStandardMaterial({
      color: 0x8cff3d,
      emissive: 0x8cff3d,
      emissiveIntensity: 1.9,
      roughness: 0.28,
      metalness: 0.65
    }),
    neonD: new THREE.MeshStandardMaterial({
      color: 0xff8b2e,
      emissive: 0xff8b2e,
      emissiveIntensity: 2.05,
      roughness: 0.28,
      metalness: 0.65
    }),
    neonSoft: new THREE.MeshStandardMaterial({
      color: 0xfff2c4,
      emissive: 0xfff2c4,
      emissiveIntensity: 2.4,
      roughness: 0.2,
      metalness: 0.55
    }),
    cloudMist: new THREE.MeshBasicMaterial({
      color: getRuntimeTuningColor("clouds.mistColor", 0x6a88aa),
      map: textures.cloudSoft,
      alphaMap: textures.cloudSoft,
      transparent: true,
      opacity: getRuntimeTuningNumber("clouds.mistOpacity", 0.014),
      alphaTest: 0,
      depthWrite: false,
      fog: true
    }),
    windowPanelAmber: new THREE.MeshBasicMaterial({
      color: 0xfff2b6,
      transparent: false,
      toneMapped: false,
      fog: false
    }),
    windowPanelWarm: new THREE.MeshBasicMaterial({
      color: 0xffcc8a,
      transparent: false,
      toneMapped: false,
      fog: false
    }),
    windowPanelPink: new THREE.MeshBasicMaterial({
      color: 0xffb8df,
      transparent: false,
      toneMapped: false,
      fog: false
    }),
    windowPanelCyan: new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: false,
      toneMapped: false,
      fog: false
    }),
    windowPanelSoft: new THREE.MeshBasicMaterial({
      color: 0xffe8a3,
      transparent: true,
      opacity: 0.99,
      toneMapped: false,
      fog: false
    }),
    standCoffee: new THREE.MeshStandardMaterial({
      color: 0x6e4b2c,
      emissive: 0x3d2817,
      emissiveIntensity: 1.25,
      roughness: 0.5,
      metalness: 0.2
    }),
    standCoffeeRoof: new THREE.MeshStandardMaterial({
      color: 0x6e4b2c,
      emissive: 0x6e4b2c,
      emissiveIntensity: 1.95,
      roughness: 0.42,
      metalness: 0.2
    }),
    standFlower: new THREE.MeshStandardMaterial({
      color: 0x39a96b,
      emissive: 0x1f5d3b,
      emissiveIntensity: 1.3,
      roughness: 0.48,
      metalness: 0.2
    }),
    standFlowerRoof: new THREE.MeshStandardMaterial({
      color: 0x39a96b,
      emissive: 0x39a96b,
      emissiveIntensity: 2.0,
      roughness: 0.4,
      metalness: 0.2
    }),
    standAdult: new THREE.MeshStandardMaterial({
      color: 0xff5cb7,
      emissive: 0x8d2f61,
      emissiveIntensity: 1.35,
      roughness: 0.44,
      metalness: 0.22
    }),
    standAdultRoof: new THREE.MeshStandardMaterial({
      color: 0xff5cb7,
      emissive: 0xff5cb7,
      emissiveIntensity: 2.1,
      roughness: 0.38,
      metalness: 0.22
    }),
    standTravel: new THREE.MeshStandardMaterial({
      color: 0x3f8df8,
      emissive: 0x1f477d,
      emissiveIntensity: 1.25,
      roughness: 0.48,
      metalness: 0.2
    }),
    standTravelRoof: new THREE.MeshStandardMaterial({
      color: 0x3f8df8,
      emissive: 0x3f8df8,
      emissiveIntensity: 2.0,
      roughness: 0.4,
      metalness: 0.2
    }),
    standTaxi: new THREE.MeshStandardMaterial({
      color: 0xffda44,
      emissive: 0x8d6d1f,
      emissiveIntensity: 1.24,
      roughness: 0.52,
      metalness: 0.18
    }),
    standTaxiRoof: new THREE.MeshStandardMaterial({
      color: 0xffda44,
      emissive: 0xffda44,
      emissiveIntensity: 2.05,
      roughness: 0.44,
      metalness: 0.18
    }),
    standRestaurant: new THREE.MeshStandardMaterial({
      color: 0x9b59ff,
      emissive: 0x54288a,
      emissiveIntensity: 1.3,
      roughness: 0.46,
      metalness: 0.22
    }),
    standRestaurantRoof: new THREE.MeshStandardMaterial({
      color: 0x9b59ff,
      emissive: 0x9b59ff,
      emissiveIntensity: 2.0,
      roughness: 0.4,
      metalness: 0.22
    }),
    standMusicBar: new THREE.MeshStandardMaterial({
      color: 0xff8a3d,
      emissive: 0x8a461f,
      emissiveIntensity: 1.28,
      roughness: 0.45,
      metalness: 0.22
    }),
    standMusicBarRoof: new THREE.MeshStandardMaterial({
      color: 0xff8a3d,
      emissive: 0xff8a3d,
      emissiveIntensity: 2.0,
      roughness: 0.39,
      metalness: 0.22
    }),
    standDoor: new THREE.MeshStandardMaterial({
      color: 0x1c2431,
      emissive: 0x0a111a,
      emissiveIntensity: 0.6,
      roughness: 0.62,
      metalness: 0.2
    })
  }

  const buildingRandomMaterialCount = 12
  for (let materialIndex = 0; materialIndex < buildingRandomMaterialCount; materialIndex += 1) {
    const materialKey = `buildingRandom${String(materialIndex + 1).padStart(2, "0")}`
    materials[materialKey] = _createRandomBuildingMaterial()
  }

  return materials
}

/**
 * Build shared geometry instances.
 * @returns {Record<string, THREE.BufferGeometry>}
 */
function _createGeometries() {
  return {
    walkway: new THREE.BoxGeometry(gameConfig.world.walkwayWidth, gameConfig.world.walkwayHeight, gameConfig.world.chunkLength),
    ground: new THREE.BoxGeometry(1200, 0.04, gameConfig.world.chunkLength),
    guardrail: new THREE.BoxGeometry(0.15, 1.1, gameConfig.world.chunkLength),
    building: new THREE.BoxGeometry(1, 1, 1),
    neonStrip: new THREE.BoxGeometry(0.15, 1, 0.18),
    neonBand: new THREE.BoxGeometry(1, 1, 1),
    signPanel: new THREE.BoxGeometry(1, 1, 0.26),
    windowPanel: new THREE.BoxGeometry(0.7, 1.15, 0.08),
    cloudMist: new THREE.CircleGeometry(1, 24),
    stand: new THREE.BoxGeometry(1, 1, 1)
  }
}

/**
 * Build color and material palettes.
 * @param {Record<string, THREE.Material>} materials
 * @returns {object}
 */
function _createPalettes(materials) {
  const buildingRandomMaterials = Object.entries(materials)
    .filter(([materialKey]) => materialKey.startsWith("buildingRandom"))
    .map(([, material]) => material)

  return {
    neon: [materials.neonA, materials.neonB, materials.neonC, materials.neonD],
    building: {
      base: materials.buildingBase,
      random: buildingRandomMaterials
    },
    windowBuildingMaterial: [
      materials.windowPanelAmber,
      materials.windowPanelWarm,
      materials.windowPanelPink,
      materials.windowPanelCyan,
      materials.windowPanelSoft
    ],
    standShops: [
      { id: "coffeeShop", material: materials.standCoffee, roofMaterial: materials.standCoffeeRoof },
      { id: "flowerShop", material: materials.standFlower, roofMaterial: materials.standFlowerRoof },
      { id: "adultShop", material: materials.standAdult, roofMaterial: materials.standAdultRoof },
      { id: "travelShop", material: materials.standTravel, roofMaterial: materials.standTravelRoof },
      { id: "taxiShop", material: materials.standTaxi, roofMaterial: materials.standTaxiRoof },
      { id: "restaurant", material: materials.standRestaurant, roofMaterial: materials.standRestaurantRoof },
      { id: "musicBar", material: materials.standMusicBar, roofMaterial: materials.standMusicBarRoof }
    ]
  }
}

/**
 * Create one random dark building material variant.
 * @returns {THREE.MeshStandardMaterial}
 */
function _createRandomBuildingMaterial() {
  const hue = Math.random()
  const saturation = 0.16 + Math.random() * 0.52
  const lightness = 0.1 + Math.random() * 0.25
  const color = new THREE.Color().setHSL(hue, saturation, lightness)
  const emissive = color.clone().multiplyScalar(0.52).lerp(new THREE.Color(0x060a12), 0.58)
  const roughness = 0.52 + Math.random() * 0.25
  const metalness = 0.14 + Math.random() * 0.2

  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    roughness,
    metalness
  })
}

/**
 * Create a soft cloud alpha texture from canvas.
 * @param {number} size
 * @returns {THREE.Texture}
 */
function _createCloudTexture(size) {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")

  context.clearRect(0, 0, size, size)

  const coreGradient = context.createRadialGradient(size * 0.5, size * 0.5, size * 0.1, size * 0.5, size * 0.5, size * 0.5)
  coreGradient.addColorStop(0, "rgba(255,255,255,0.9)")
  coreGradient.addColorStop(0.35, "rgba(255,255,255,0.55)")
  coreGradient.addColorStop(0.75, "rgba(255,255,255,0.18)")
  coreGradient.addColorStop(1, "rgba(255,255,255,0)")
  context.fillStyle = coreGradient
  context.fillRect(0, 0, size, size)

  for (let blobIndex = 0; blobIndex < 26; blobIndex += 1) {
    const x = Math.random() * size
    const y = Math.random() * size
    const radius = size * (0.05 + Math.random() * 0.18)
    const alpha = 0.08 + Math.random() * 0.2

    const blobGradient = context.createRadialGradient(x, y, radius * 0.1, x, y, radius)
    blobGradient.addColorStop(0, `rgba(255,255,255,${alpha})`)
    blobGradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = blobGradient
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
