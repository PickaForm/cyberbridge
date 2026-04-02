/**
 * Player renderer module.
 *
 * Usage:
 * const renderer = new PlayerRenderer(scene)
 * renderer.setPosition(0, 1.08, 0)
 */
import * as THREE from "three"
import { getRuntimeTuningColor, getRuntimeTuningNumber } from "../config/tuningRuntime.js"

export class PlayerRenderer {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene
    this.mesh = this._createMesh()
    this.scene.add(this.mesh)
  }

  /**
   * Get the player mesh for camera targeting.
   * @returns {THREE.Mesh}
   */
  getMesh() {
    return this.mesh
  }

  /**
   * Set player mesh world position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z)
  }

  /**
   * Apply runtime-tuned material values on existing mesh.
   * @returns {void}
   */
  applyRuntimeTuning() {
    const material = this.mesh.material
    if (!material || !material.isMeshStandardMaterial) {
      return
    }

    material.color.setHex(getRuntimeTuningColor("player.color", 0xffe16e))
    material.emissive.setHex(getRuntimeTuningColor("player.emissive", 0xb66318))
    material.emissiveIntensity = getRuntimeTuningNumber("player.emissiveIntensity", 1.25)
    material.roughness = getRuntimeTuningNumber("player.roughness", 0.4)
    material.metalness = getRuntimeTuningNumber("player.metalness", 0.35)
    material.needsUpdate = true
  }

  /**
   * Dispose render resources.
   * @returns {void}
   */
  dispose() {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }

  /**
   * Create player placeholder mesh.
   * @returns {THREE.Mesh}
   * @private
   * @ignore
   */
  _createMesh() {
    const geometry = new THREE.BoxGeometry(1, 1.8, 1)
    const material = new THREE.MeshStandardMaterial({
      color: getRuntimeTuningColor("player.color", 0xffe16e),
      emissive: getRuntimeTuningColor("player.emissive", 0xb66318),
      emissiveIntensity: getRuntimeTuningNumber("player.emissiveIntensity", 1.25),
      roughness: getRuntimeTuningNumber("player.roughness", 0.4),
      metalness: getRuntimeTuningNumber("player.metalness", 0.35)
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 1.08, 0)
    return mesh
  }
}
