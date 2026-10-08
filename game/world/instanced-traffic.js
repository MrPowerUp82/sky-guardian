import * as THREE from 'three';

// Renders the moving cars as InstancedMeshes (one per car-model part) instead of
// ~6 separate meshes per car. Only cars within `radius` of the camera are written
// each frame, so far traffic costs nothing in either the main or the shadow pass.
export class InstancedTraffic {
  /**
   * @param {THREE.Object3D} parent where the instanced meshes are added
   * @param {Array<{key:number, wrapper:THREE.Object3D, capacity:number}>} models
   *   `wrapper` is a normalized, identity-placed instance of the car model.
   */
  constructor(parent, models) {
    this.models = models.map(({ wrapper, capacity }) => {
      wrapper.updateMatrixWorld(true);
      const parts = [];
      wrapper.traverse(obj => {
        if (!obj.isMesh) return;
        const mesh = new THREE.InstancedMesh(obj.geometry, obj.material, capacity);
        mesh.castShadow = obj.castShadow;
        mesh.receiveShadow = obj.receiveShadow;
        mesh.frustumCulled = false; // instance bounds change every frame
        mesh.count = 0;
        parent.add(mesh);
        parts.push({ mesh, rel: obj.matrixWorld.clone() });
      });
      return { parts, cars: [] };
    });
    this._m = new THREE.Matrix4();
  }

  // `modelIndex` is the position of the model in the constructor array.
  register(modelIndex, object) {
    this.models[modelIndex].cars.push(object);
  }

  update(cameraPosition, radius = 200) {
    const r2 = radius * radius;
    for (const model of this.models) {
      let n = 0;
      for (const car of model.cars) {
        const p = car.position;
        const dx = p.x - cameraPosition.x, dy = p.y - cameraPosition.y, dz = p.z - cameraPosition.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        car.updateMatrix();
        for (const part of model.parts) {
          this._m.multiplyMatrices(car.matrix, part.rel);
          part.mesh.setMatrixAt(n, this._m);
        }
        n++;
      }
      for (const part of model.parts) {
        part.mesh.count = n;
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
