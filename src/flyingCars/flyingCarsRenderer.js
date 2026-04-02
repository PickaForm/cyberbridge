/**
 * Flying cars renderer module using instanced meshes.
 *
 * Usage:
 * const renderer = new FlyingCarsRenderer(scene, 120)
 * renderer.setCarAppearance(0, { color: 0xff66cc, isGlow: true, lengthScale: 1.4, widthScale: 0.8, heightScale: 0.65, frontWidthRatio: 0.72, frontHeightRatio: 0.3, direction: 1 })
 * renderer.setCarMatrix(0, 0, 8, 12)
 * renderer.commit()
 */
import * as THREE from "three"

export class FlyingCarsRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {number} maxCars
   */
  constructor(scene, maxCars) {
    this.scene = scene
    this.maxCars = maxCars
    this.carGeometry = this._createCarGeometry()
    this.frontWidthRatios = new Float32Array(maxCars)
    this.frontHeightRatios = new Float32Array(maxCars)
    this.frontWidthAttribute = new THREE.InstancedBufferAttribute(this.frontWidthRatios, 1)
    this.frontHeightAttribute = new THREE.InstancedBufferAttribute(this.frontHeightRatios, 1)
    this._initializeFrontProfileAttributes()
    this.carGeometry.setAttribute("frontWidthRatio", this.frontWidthAttribute)
    this.carGeometry.setAttribute("frontHeightRatio", this.frontHeightAttribute)
    this.normalMaterial = this._createNormalMaterial()
    this.glowMaterial = this._createGlowMaterial()
    this.normalMesh = this._createInstanceMesh(this.normalMaterial)
    this.glowMesh = this._createInstanceMesh(this.glowMaterial)
    this.carProfiles = new Array(maxCars)
    this.instanceDummy = new THREE.Object3D()

    this.scene.add(this.normalMesh)
    this.scene.add(this.glowMesh)
  }

  /**
   * Set one car appearance profile.
   * @param {number} instanceIndex
   * @param {object} carProfile
   * @returns {void}
   */
  setCarAppearance(instanceIndex, carProfile) {
    this.carProfiles[instanceIndex] = carProfile
    const profile = this.carProfiles[instanceIndex]
    const carColor = new THREE.Color(profile?.color ?? 0x57c9ff)
    const nonGlowLuminosity = THREE.MathUtils.clamp(profile?.nonGlowLuminosity ?? 1, 0.2, 2.5)
    const glowIntensity = THREE.MathUtils.clamp(profile?.glowIntensity ?? 1, 0, 3)
    const frontWidthRatio = THREE.MathUtils.clamp(profile?.frontWidthRatio ?? 1, 0.5, 1)
    const frontHeightRatio = THREE.MathUtils.clamp(profile?.frontHeightRatio ?? 1, 0, 1)
    const baseColor = this._buildBaseColor(carColor, nonGlowLuminosity)
    const glowColor = carColor.clone().multiplyScalar(Math.max(0.08, glowIntensity))

    this.frontWidthRatios[instanceIndex] = frontWidthRatio
    this.frontHeightRatios[instanceIndex] = frontHeightRatio
    this.normalMesh.setColorAt(instanceIndex, baseColor)
    this.glowMesh.setColorAt(instanceIndex, glowColor)
  }

  /**
   * Set one car matrix in instanced buffers.
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {boolean} visible
   * @returns {void}
   */
  setCarMatrix(instanceIndex, x, y, z, visible = true) {
    if (!visible) {
      this._hideInstance(this.normalMesh, instanceIndex)
      this._hideInstance(this.glowMesh, instanceIndex)
      return
    }

    const profile = this.carProfiles[instanceIndex] ?? {
      isGlow: false,
      lengthScale: 1.35,
      widthScale: 0.85,
      heightScale: 0.65,
      direction: 1
    }

    const lengthScale = profile.lengthScale ?? 1.35
    const widthScale = profile.widthScale ?? 0.85
    const heightScale = profile.heightScale ?? 0.65
    const direction = profile.direction ?? 1
    const isGlow = profile.isGlow === true
    const glowIntensity = THREE.MathUtils.clamp(profile.glowIntensity ?? 1, 0, 3)

    if (isGlow) {
      const glowScaleFactor = 1 + glowIntensity * 0.24
      this._writeInstance(this.normalMesh, instanceIndex, x, y, z, lengthScale, widthScale, heightScale, direction)
      this._writeInstance(
        this.glowMesh,
        instanceIndex,
        x,
        y,
        z,
        lengthScale * glowScaleFactor,
        widthScale * glowScaleFactor,
        heightScale * glowScaleFactor,
        direction
      )
      return
    }

    this._hideInstance(this.glowMesh, instanceIndex)
    this._writeInstance(this.normalMesh, instanceIndex, x, y, z, lengthScale, widthScale, heightScale, direction)
  }

  /**
   * Mark all instanced updates for GPU upload.
   * @returns {void}
   */
  commit() {
    this.normalMesh.instanceMatrix.needsUpdate = true
    this.glowMesh.instanceMatrix.needsUpdate = true
    this.frontWidthAttribute.needsUpdate = true
    this.frontHeightAttribute.needsUpdate = true
    if (this.normalMesh.instanceColor) {
      this.normalMesh.instanceColor.needsUpdate = true
    }
    if (this.glowMesh.instanceColor) {
      this.glowMesh.instanceColor.needsUpdate = true
    }
  }

  /**
   * Dispose render resources.
   * @returns {void}
   */
  dispose() {
    this.scene.remove(this.normalMesh)
    this.scene.remove(this.glowMesh)
    this.carGeometry.dispose()
    this.normalMaterial.dispose()
    this.glowMaterial.dispose()
  }

  /**
   * Build shared car geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createCarGeometry() {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const positions = geometry.getAttribute("position")
    const colorArray = new Float32Array(positions.count * 3)

    for (let index = 0; index < positions.count; index += 1) {
      const baseOffset = index * 3
      colorArray[baseOffset] = 1
      colorArray[baseOffset + 1] = 1
      colorArray[baseOffset + 2] = 1
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3))
    return geometry
  }

  /**
   * Build material for non-glow cars.
   * @returns {THREE.Material}
   * @private
   * @ignore
   */
  _createNormalMaterial() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false
    })
    this._injectFrontProfileShader(material)
    return material
  }

  /**
   * Build material for glow cars.
   * @returns {THREE.Material}
   * @private
   * @ignore
   */
  _createGlowMaterial() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
    this._injectFrontProfileShader(material)
    return material
  }

  /**
   * Build one instanced mesh for cars.
   * @param {THREE.Material} material
   * @returns {THREE.InstancedMesh}
   * @private
   * @ignore
   */
  _createInstanceMesh(material) {
    const instancedMesh = new THREE.InstancedMesh(this.carGeometry, material, this.maxCars)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instancedMesh.frustumCulled = false
    const defaultColor = new THREE.Color(0xffffff)
    for (let index = 0; index < this.maxCars; index += 1) {
      instancedMesh.setColorAt(index, defaultColor)
    }
    return instancedMesh
  }

  /**
   * Hide one instanced entry.
   * @param {THREE.InstancedMesh} mesh
   * @param {number} instanceIndex
   * @returns {void}
   * @private
   * @ignore
   */
  _hideInstance(mesh, instanceIndex) {
    this.instanceDummy.position.set(0, -9999, 0)
    this.instanceDummy.rotation.set(0, 0, 0)
    this.instanceDummy.scale.set(0.0001, 0.0001, 0.0001)
    this.instanceDummy.updateMatrix()
    mesh.setMatrixAt(instanceIndex, this.instanceDummy.matrix)
  }

  /**
   * Write one car instance transform.
   * @param {THREE.InstancedMesh} mesh
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} lengthScale
   * @param {number} widthScale
   * @param {number} heightScale
   * @param {number} direction
   * @returns {void}
   * @private
   * @ignore
   */
  _writeInstance(mesh, instanceIndex, x, y, z, lengthScale, widthScale, heightScale, direction) {
    this.instanceDummy.position.set(x, y, z)
    this.instanceDummy.rotation.set(0, direction < 0 ? Math.PI : 0, 0)
    this.instanceDummy.scale.set(widthScale, heightScale, lengthScale)
    this.instanceDummy.updateMatrix()
    mesh.setMatrixAt(instanceIndex, this.instanceDummy.matrix)
  }

  /**
   * Initialize default front profile attributes.
   * @returns {void}
   * @private
   * @ignore
   */
  _initializeFrontProfileAttributes() {
    for (let index = 0; index < this.maxCars; index += 1) {
      this.frontWidthRatios[index] = 1
      this.frontHeightRatios[index] = 1
    }
  }

  /**
   * Inject per-instance front-face profiling into material shader.
   * @param {THREE.MeshBasicMaterial} material
   * @returns {void}
   * @private
   * @ignore
   */
  _injectFrontProfileShader(material) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float frontWidthRatio;
attribute float frontHeightRatio;`
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
if (transformed.z > 0.0) {
  transformed.x *= frontWidthRatio;
  transformed.y *= frontHeightRatio;
}`
        )
    }
  }

  /**
   * Lift too-dark colors so non-glow cars remain readable at night.
   * @param {THREE.Color} color
   * @returns {THREE.Color}
   * @private
   * @ignore
   */
  _liftDarkColor(color) {
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    if (luminance >= 0.28) {
      return color
    }

    const boostFactor = THREE.MathUtils.clamp((0.28 - luminance) * 0.9, 0.05, 0.22)
    return color.clone().lerp(new THREE.Color(0xffffff), boostFactor)
  }

  /**
   * Build a non-glow color that stays visible without triggering heavy bloom.
   * @param {THREE.Color} color
   * @returns {THREE.Color}
   * @private
   * @ignore
   */
  _buildBaseColor(color, nonGlowLuminosity) {
    const liftedColor = this._liftDarkColor(color)
    const maxChannel = Math.max(liftedColor.r, liftedColor.g, liftedColor.b, 0.0001)
    const targetMax = THREE.MathUtils.clamp(0.42 * nonGlowLuminosity, 0.18, 0.92)
    const scale = Math.min(1, targetMax / maxChannel)
    return liftedColor.clone().multiplyScalar(scale)
  }
}
