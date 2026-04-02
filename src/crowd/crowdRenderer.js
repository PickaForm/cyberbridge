/**
 * Crowd renderer module using instanced meshes.
 *
 * Usage:
 * const renderer = new CrowdRenderer(scene, 140)
 * renderer.setAgentBodyVariant(0, "pink")
 * renderer.setAgentMatrix(0, 1.2, 4.8, 1.05)
 * renderer.commit()
 */
import * as THREE from "three"
import { getRuntimeTuningColor } from "../config/tuningRuntime.js"

export class CrowdRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {number} maxAgents
   */
  constructor(scene, maxAgents) {
    this.scene = scene
    this.maxAgents = maxAgents
    const boysColor = new THREE.Color(getRuntimeTuningColor("crowd.boysColor", 0x4a9dff))
    const girlsColor = new THREE.Color(getRuntimeTuningColor("crowd.girlsColor", 0xff76d6))
    this.blueBodyColor = this._buildBaseColor(boysColor, 1.2)
    this.pinkBodyColor = this._buildBaseColor(girlsColor, 1.2)
    this.agentMaterial = this._createMaterial()
    this.agentGeometry = this._createGeometry()
    this.instanceMesh = this._createInstanceMesh()
    this.eyeMaterial = this._createEyeMaterial()
    this.mouthMaterial = this._createMouthMaterial()
    this.eyeSquareGeometry = this._createEyeSquareGeometry()
    this.eyeRectangleGeometry = this._createEyeRectangleGeometry()
    this.eyeRoundGeometry = this._createEyeRoundGeometry()
    this.eyeCrossGeometry = this._createEyeCrossGeometry()
    this.mouthNeutralGeometry = this._createMouthNeutralGeometry()
    this.mouthArcGeometry = this._createMouthArcGeometry()
    this.eyeSquareLeftMesh = this._createFaceInstanceMesh(this.eyeSquareGeometry, this.eyeMaterial)
    this.eyeSquareRightMesh = this._createFaceInstanceMesh(this.eyeSquareGeometry, this.eyeMaterial)
    this.eyeRectangleLeftMesh = this._createFaceInstanceMesh(this.eyeRectangleGeometry, this.eyeMaterial)
    this.eyeRectangleRightMesh = this._createFaceInstanceMesh(this.eyeRectangleGeometry, this.eyeMaterial)
    this.eyeRoundLeftMesh = this._createFaceInstanceMesh(this.eyeRoundGeometry, this.eyeMaterial)
    this.eyeRoundRightMesh = this._createFaceInstanceMesh(this.eyeRoundGeometry, this.eyeMaterial)
    this.eyeCrossLeftMesh = this._createFaceInstanceMesh(this.eyeCrossGeometry, this.eyeMaterial)
    this.eyeCrossRightMesh = this._createFaceInstanceMesh(this.eyeCrossGeometry, this.eyeMaterial)
    this.mouthHappyMesh = this._createFaceInstanceMesh(this.mouthArcGeometry, this.mouthMaterial)
    this.mouthNeutralMesh = this._createFaceInstanceMesh(this.mouthNeutralGeometry, this.mouthMaterial)
    this.mouthSadMesh = this._createFaceInstanceMesh(this.mouthArcGeometry, this.mouthMaterial)
    this.agentFaces = new Array(maxAgents)
    this.faceVisibility = new Array(maxAgents).fill(true)
    this.instanceDummy = new THREE.Object3D()

    this.scene.add(this.instanceMesh)
    this.scene.add(this.eyeSquareLeftMesh)
    this.scene.add(this.eyeSquareRightMesh)
    this.scene.add(this.eyeRectangleLeftMesh)
    this.scene.add(this.eyeRectangleRightMesh)
    this.scene.add(this.eyeRoundLeftMesh)
    this.scene.add(this.eyeRoundRightMesh)
    this.scene.add(this.eyeCrossLeftMesh)
    this.scene.add(this.eyeCrossRightMesh)
    this.scene.add(this.mouthHappyMesh)
    this.scene.add(this.mouthNeutralMesh)
    this.scene.add(this.mouthSadMesh)
  }

  /**
   * Set one agent matrix in the instanced buffer.
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} z
   * @param {number} y
   * @param {boolean} faceVisible
   * @returns {void}
   */
  setAgentMatrix(instanceIndex, x, z, y, faceVisible = true) {
    this.instanceDummy.position.set(x, y, z)
    this.instanceDummy.rotation.set(0, 0, 0)
    this.instanceDummy.scale.set(1, 1, 1)
    this.instanceDummy.updateMatrix()
    this.instanceMesh.setMatrixAt(instanceIndex, this.instanceDummy.matrix)
    this._syncFaceMatrices(instanceIndex, x, y, z, faceVisible)
  }

  /**
   * Set one agent facial appearance profile.
   * @param {number} instanceIndex
   * @param {object} faceProfile
   * @returns {void}
   */
  setAgentAppearance(instanceIndex, faceProfile) {
    this.agentFaces[instanceIndex] = faceProfile
  }

  /**
   * Set one agent body color variant.
   * @param {number} instanceIndex
   * @param {"blue" | "pink"} bodyVariant
   * @returns {void}
   */
  setAgentBodyVariant(instanceIndex, bodyVariant) {
    const variantColor = bodyVariant === "pink" ? this.pinkBodyColor : this.blueBodyColor
    this.instanceMesh.setColorAt(instanceIndex, variantColor)
  }

  /**
   * Mark all instance matrix updates for GPU upload.
   * @returns {void}
   */
  commit() {
    this.instanceMesh.instanceMatrix.needsUpdate = true
    if (this.instanceMesh.instanceColor) {
      this.instanceMesh.instanceColor.needsUpdate = true
    }
    this.eyeSquareLeftMesh.instanceMatrix.needsUpdate = true
    this.eyeSquareRightMesh.instanceMatrix.needsUpdate = true
    this.eyeRectangleLeftMesh.instanceMatrix.needsUpdate = true
    this.eyeRectangleRightMesh.instanceMatrix.needsUpdate = true
    this.eyeRoundLeftMesh.instanceMatrix.needsUpdate = true
    this.eyeRoundRightMesh.instanceMatrix.needsUpdate = true
    this.eyeCrossLeftMesh.instanceMatrix.needsUpdate = true
    this.eyeCrossRightMesh.instanceMatrix.needsUpdate = true
    this.mouthHappyMesh.instanceMatrix.needsUpdate = true
    this.mouthNeutralMesh.instanceMatrix.needsUpdate = true
    this.mouthSadMesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Dispose render resources.
   * @returns {void}
   */
  dispose() {
    this.scene.remove(this.instanceMesh)
    this.scene.remove(this.eyeSquareLeftMesh)
    this.scene.remove(this.eyeSquareRightMesh)
    this.scene.remove(this.eyeRectangleLeftMesh)
    this.scene.remove(this.eyeRectangleRightMesh)
    this.scene.remove(this.eyeRoundLeftMesh)
    this.scene.remove(this.eyeRoundRightMesh)
    this.scene.remove(this.eyeCrossLeftMesh)
    this.scene.remove(this.eyeCrossRightMesh)
    this.scene.remove(this.mouthHappyMesh)
    this.scene.remove(this.mouthNeutralMesh)
    this.scene.remove(this.mouthSadMesh)
    this.instanceMesh.geometry.dispose()
    this.instanceMesh.material.dispose()
    this.eyeSquareGeometry.dispose()
    this.eyeRectangleGeometry.dispose()
    this.eyeRoundGeometry.dispose()
    this.eyeCrossGeometry.dispose()
    this.mouthNeutralGeometry.dispose()
    this.mouthArcGeometry.dispose()
    this.eyeMaterial.dispose()
    this.mouthMaterial.dispose()
  }

  /**
   * Build shared crowd material.
   * @returns {THREE.Material}
   * @private
   * @ignore
   */
  _createMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false
    })
  }

  /**
   * Build shared crowd geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createGeometry() {
    const geometry = new THREE.BoxGeometry(0.9, 1.8, 0.9)
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
   * Build eye material.
   * @returns {THREE.Material}
   * @private
   * @ignore
   */
  _createEyeMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x7df6ff,
      emissive: 0x7df6ff,
      emissiveIntensity: 2.1,
      roughness: 0.22,
      metalness: 0.08,
      depthTest: true,
      depthWrite: false,
      toneMapped: true
    })
  }

  /**
   * Build mouth material.
   * @returns {THREE.Material}
   * @private
   * @ignore
   */
  _createMouthMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x111923,
      emissive: 0x090f17,
      emissiveIntensity: 0.22,
      roughness: 0.35,
      metalness: 0.08
    })
  }

  /**
   * Build square eye geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createEyeSquareGeometry() {
    return new THREE.BoxGeometry(0.12, 0.12, 0.035)
  }

  /**
   * Build rectangular eye geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createEyeRectangleGeometry() {
    return new THREE.BoxGeometry(0.18, 0.085, 0.035)
  }

  /**
   * Build round eye geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createEyeRoundGeometry() {
    return new THREE.SphereGeometry(0.06, 10, 10)
  }

  /**
   * Build cross eye geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createEyeCrossGeometry() {
    return new THREE.BoxGeometry(0.16, 0.055, 0.035)
  }

  /**
   * Build neutral mouth geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createMouthNeutralGeometry() {
    return new THREE.BoxGeometry(0.27, 0.045, 0.03)
  }

  /**
   * Build arc mouth geometry.
   * @returns {THREE.BufferGeometry}
   * @private
   * @ignore
   */
  _createMouthArcGeometry() {
    return new THREE.TorusGeometry(0.12, 0.02, 6, 16, Math.PI)
  }

  /**
   * Build instanced mesh used for all agents.
   * @returns {THREE.InstancedMesh}
   * @private
   * @ignore
   */
  _createInstanceMesh() {
    const instancedMesh = new THREE.InstancedMesh(this.agentGeometry, this.agentMaterial, this.maxAgents)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instancedMesh.frustumCulled = false
    // Keep raycasting reliable even when recycled NPC instances are far from world origin.
    instancedMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000000)
    for (let index = 0; index < this.maxAgents; index += 1) {
      instancedMesh.setColorAt(index, this.blueBodyColor)
    }
    return instancedMesh
  }

  /**
   * Lift too-dark NPC colors so body stays readable.
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
   * @param {number} nonGlowLuminosity
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

  /**
   * Build one face instanced mesh.
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @returns {THREE.InstancedMesh}
   * @private
   * @ignore
   */
  _createFaceInstanceMesh(geometry, material) {
    const instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxAgents)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    instancedMesh.frustumCulled = false
    return instancedMesh
  }

  /**
   * Write all face matrices for one agent.
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {boolean} faceVisible
   * @returns {void}
   * @private
   * @ignore
   */
  _syncFaceMatrices(instanceIndex, x, y, z, faceVisible) {
    if (!faceVisible) {
      if (this.faceVisibility[instanceIndex]) {
        this._hideEyeInstances(instanceIndex)
        this._hideMouthInstances(instanceIndex)
        this.faceVisibility[instanceIndex] = false
      }
      return
    }

    this.faceVisibility[instanceIndex] = true
    const faceProfile = this.agentFaces[instanceIndex] ?? {
      mood: "neutral",
      eyeShape: "square",
      eyeScale: 1,
      eyeSpacing: 0.11,
      eyeYOffset: 0.32,
      mouthScale: 1,
      mouthYOffset: 0.08,
      mouthArcDepth: 1,
      mouthTilt: 0,
      eyeColor: 0x7df6ff,
      facingDirection: 1
    }

    this._hideEyeInstances(instanceIndex)
    this._hideMouthInstances(instanceIndex)

    const eyeScale = faceProfile.eyeScale ?? 1
    const eyeSpacing = faceProfile.eyeSpacing ?? 0.11
    const eyeYOffset = faceProfile.eyeYOffset ?? 0.32
    const mouthScale = faceProfile.mouthScale ?? 1
    const mouthYOffset = faceProfile.mouthYOffset ?? 0.08
    const mouthArcDepth = faceProfile.mouthArcDepth ?? 1
    const mouthTilt = faceProfile.mouthTilt ?? 0
    const forwardSign = faceProfile.facingDirection >= 0 ? 1 : -1
    const eyeY = y + eyeYOffset
    const faceZ = z + 0.6 * forwardSign
    const leftEyeX = x - eyeSpacing
    const rightEyeX = x + eyeSpacing

    this._writeEye(faceProfile.eyeShape, "left", instanceIndex, leftEyeX, eyeY, faceZ, eyeScale)
    this._writeEye(faceProfile.eyeShape, "right", instanceIndex, rightEyeX, eyeY, faceZ, eyeScale)
    this._writeMouth(faceProfile.mood, instanceIndex, x, y + mouthYOffset, faceZ, mouthScale, mouthArcDepth, mouthTilt)
  }

  /**
   * Hide all eye types for one instance.
   * @param {number} instanceIndex
   * @returns {void}
   * @private
   * @ignore
   */
  _hideEyeInstances(instanceIndex) {
    this._hideInstance(this.eyeSquareLeftMesh, instanceIndex)
    this._hideInstance(this.eyeSquareRightMesh, instanceIndex)
    this._hideInstance(this.eyeRectangleLeftMesh, instanceIndex)
    this._hideInstance(this.eyeRectangleRightMesh, instanceIndex)
    this._hideInstance(this.eyeRoundLeftMesh, instanceIndex)
    this._hideInstance(this.eyeRoundRightMesh, instanceIndex)
    this._hideInstance(this.eyeCrossLeftMesh, instanceIndex)
    this._hideInstance(this.eyeCrossRightMesh, instanceIndex)
  }

  /**
   * Hide all mouth types for one instance.
   * @param {number} instanceIndex
   * @returns {void}
   * @private
   * @ignore
   */
  _hideMouthInstances(instanceIndex) {
    this._hideInstance(this.mouthHappyMesh, instanceIndex)
    this._hideInstance(this.mouthNeutralMesh, instanceIndex)
    this._hideInstance(this.mouthSadMesh, instanceIndex)
  }

  /**
   * Hide one instanced entry by collapsing its scale.
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
   * Write one eye matrix according to shape and side.
   * @param {string} eyeShape
   * @param {"left" | "right"} side
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} eyeScale
   * @returns {void}
   * @private
   * @ignore
   */
  _writeEye(eyeShape, side, instanceIndex, x, y, z, eyeScale) {
    const shapeKey = eyeShape ?? "square"
    if (shapeKey === "rectangle") {
      this._writeFaceInstance(side === "left" ? this.eyeRectangleLeftMesh : this.eyeRectangleRightMesh, instanceIndex, x, y, z, eyeScale, 0)
      return
    }

    if (shapeKey === "round") {
      this._writeFaceInstance(side === "left" ? this.eyeRoundLeftMesh : this.eyeRoundRightMesh, instanceIndex, x, y, z, eyeScale, 0)
      return
    }

    if (shapeKey === "cross") {
      this._writeFaceInstance(side === "left" ? this.eyeCrossLeftMesh : this.eyeCrossRightMesh, instanceIndex, x, y, z, eyeScale, Math.PI * 0.25)
      return
    }

    this._writeFaceInstance(side === "left" ? this.eyeSquareLeftMesh : this.eyeSquareRightMesh, instanceIndex, x, y, z, eyeScale, 0)
  }

  /**
   * Write mouth matrix based on mood.
   * @param {string} mood
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} mouthScale
   * @param {number} mouthArcDepth
   * @param {number} mouthTilt
   * @returns {void}
   * @private
   * @ignore
   */
  _writeMouth(mood, instanceIndex, x, y, z, mouthScale, mouthArcDepth, mouthTilt) {
    const arcDepth = THREE.MathUtils.clamp(mouthArcDepth, 0.45, 1.7)
    if (mood === "happy") {
      this._writeFaceInstance(this.mouthHappyMesh, instanceIndex, x, y, z, mouthScale, Math.PI, mouthScale, mouthScale * arcDepth, mouthScale)
      return
    }

    if (mood === "sad") {
      this._writeFaceInstance(this.mouthSadMesh, instanceIndex, x, y + 0.035, z, mouthScale, 0, mouthScale, mouthScale * arcDepth, mouthScale)
      return
    }

    if (mood === "perplexed") {
      this._writeFaceInstance(this.mouthNeutralMesh, instanceIndex, x, y + 0.01, z, mouthScale, mouthTilt)
      return
    }

    this._writeFaceInstance(this.mouthNeutralMesh, instanceIndex, x, y + 0.01, z, mouthScale, 0)
  }

  /**
   * Write one face instance transform.
   * @param {THREE.InstancedMesh} mesh
   * @param {number} instanceIndex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} scale
   * @param {number} rotZ
   * @param {number} scaleX
   * @param {number} scaleY
   * @param {number} scaleZ
   * @returns {void}
   * @private
   * @ignore
   */
  _writeFaceInstance(mesh, instanceIndex, x, y, z, scale, rotZ, scaleX = scale, scaleY = scale, scaleZ = scale) {
    this.instanceDummy.position.set(x, y, z)
    this.instanceDummy.rotation.set(0, 0, rotZ)
    this.instanceDummy.scale.set(scaleX, scaleY, scaleZ)
    this.instanceDummy.updateMatrix()
    mesh.setMatrixAt(instanceIndex, this.instanceDummy.matrix)
  }
}
