export const FIRE_TUNING = Object.freeze({
  cellSize: 32,
  maxSpots: 12,
  coolingRate: 0.42,
  coolingStateSeconds: 0.15,
});

const cloneVec = (v = {}) => ({ x:Number(v.x)||0, y:Number(v.y)||0, z:Number(v.z)||0 });
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const dot = (a,b) => a.x*b.x + a.y*b.y + a.z*b.z;
const length = v => Math.hypot(v.x,v.y,v.z);
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});

export class FireSystem {
  constructor(tuning = FIRE_TUNING) {
    this.tuning = { ...FIRE_TUNING, ...tuning };
    this.spots = new Map();
    this.grid = new Map();
  }

  _keyFor(position) {
    const s = this.tuning.cellSize;
    return `${Math.floor(position.x/s)},${Math.floor(position.y/s)},${Math.floor(position.z/s)}`;
  }

  _cellCoords(position) {
    const s = this.tuning.cellSize;
    return [Math.floor(position.x/s),Math.floor(position.y/s),Math.floor(position.z/s)];
  }

  _addToGrid(spot) {
    const key = this._keyFor(spot.position);
    let set = this.grid.get(key);
    if (!set) this.grid.set(key, set = new Set());
    set.add(spot.id);
  }

  _removeFromGrid(spot) {
    const key = this._keyFor(spot.position);
    const set = this.grid.get(key);
    if (!set) return;
    set.delete(spot.id);
    if (!set.size) this.grid.delete(key);
  }

  addSpot({ id, eventId, position, normal, radius = 2, intensity = 1, source = 'unknown', buildingId = null } = {}) {
    if (!id || this.spots.has(id)) return null;
    if (this.getActiveSpots().length >= this.tuning.maxSpots) return null;
    const spot = {
      id: String(id), eventId: eventId ?? null,
      position: cloneVec(position), normal: cloneVec(normal || {x:0,y:1,z:0}),
      radius: Math.max(0, Number(radius) || 0), intensity: clamp01(intensity),
      source, buildingId,
      state: intensity <= 0 ? 'extinguished' : 'burning',
      coolingTimer: 0,
    };
    this.spots.set(spot.id, spot);
    this._addToGrid(spot);
    return spot;
  }

  addSpots(descriptors = []) {
    const ids = [];
    for (const descriptor of descriptors) {
      const created = this.addSpot(descriptor);
      if (created) ids.push(created.id);
    }
    return ids;
  }

  getSpot(id) { return this.spots.get(id) || null; }
  getActiveSpots() { return [...this.spots.values()].filter(s => s.state !== 'extinguished'); }
  countByEvent(eventId) { return this.getActiveSpots().filter(s => s.eventId === eventId).length; }
  remainingCapacity() { return Math.max(0, this.tuning.maxSpots - this.getActiveSpots().length); }

  querySphere(position, radius) {
    const p = cloneVec(position);
    const r = Math.max(0, Number(radius)||0);
    const s = this.tuning.cellSize;
    const [cx,cy,cz] = this._cellCoords(p);
    const cells = Math.ceil(r/s) + 1;
    const seen = new Set();
    const out = [];
    for (let x=cx-cells;x<=cx+cells;x++) for (let y=cy-cells;y<=cy+cells;y++) for (let z=cz-cells;z<=cz+cells;z++) {
      const ids = this.grid.get(`${x},${y},${z}`);
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const spot = this.spots.get(id);
        if (!spot || spot.state === 'extinguished') continue;
        const d = length(sub(spot.position,p));
        if (d <= r + spot.radius) out.push(spot);
      }
    }
    return out;
  }

  // Cools every spot within `radius` of `origin` (a spinning/gusting source with
  // no preferred direction). Returns the ids that were affected.
  applyCoolingSphere({ origin, radius = 10, dt, rate = 0.42 } = {}) {
    const o = cloneVec(origin);
    if (!(dt > 0) || !(radius > 0)) return [];
    const affected = [];
    for (const spot of this.querySphere(o, radius)) {
      const dist = length(sub(spot.position, o));
      if (dist > radius + spot.radius) continue;
      const weight = Math.max(.35, 1 - (dist / radius) * .65);
      spot.intensity = Math.max(0, spot.intensity - Math.max(0, rate) * weight * dt);
      affected.push(spot.id);
      if (spot.intensity <= 1e-6) {
        spot.intensity = 0;
        spot.state = 'extinguished';
        spot.coolingTimer = 0;
      } else {
        spot.state = 'cooling';
        spot.coolingTimer = this.tuning.coolingStateSeconds;
      }
    }
    return affected;
  }

  applyCoolingCone({ origin, direction, range = 24, halfAngleDeg = 22, dt, rate = 0.42, occluded = null } = {}) {
    const o = cloneVec(origin), d = cloneVec(direction);
    const dl = length(d);
    if (!dl || !(dt > 0) || !(range > 0)) return [];
    d.x/=dl; d.y/=dl; d.z/=dl;
    const cosLimit = Math.cos((Math.max(0,halfAngleDeg) * Math.PI) / 180);
    const affected = [];
    for (const spot of this.querySphere(o, range)) {
      const v = sub(spot.position,o);
      const dist = length(v);
      if (!dist || dist > range + spot.radius) continue;
      const forward = dot(v,d);
      if (forward <= 0) continue;
      const cos = forward / dist;
      if (cos < cosLimit) continue;
      if (occluded?.(spot)) continue;
      const angleWeight = Math.max(0, Math.min(1, (cos - cosLimit) / Math.max(1e-6, 1 - cosLimit)));
      const distanceWeight = Math.max(.35, 1 - (dist / range) * .35);
      const weight = angleWeight * distanceWeight;
      if (weight <= 0) continue;
      spot.intensity = Math.max(0, spot.intensity - Math.max(0,rate) * weight * dt);
      affected.push(spot.id);
      if (spot.intensity <= 1e-6) {
        spot.intensity = 0;
        spot.state = 'extinguished';
        spot.coolingTimer = 0;
      } else {
        spot.state = 'cooling';
        spot.coolingTimer = this.tuning.coolingStateSeconds;
      }
    }
    return affected;
  }

  update(dt) {
    const step = Math.max(0, Number(dt)||0);
    for (const spot of this.spots.values()) {
      if (spot.state !== 'cooling') continue;
      spot.coolingTimer = Math.max(0, spot.coolingTimer - step);
      if (spot.coolingTimer <= 0) spot.state = 'burning';
    }
  }

  removeEvent(eventId) {
    for (const [id, spot] of [...this.spots]) {
      if (spot.eventId !== eventId) continue;
      this._removeFromGrid(spot);
      this.spots.delete(id);
    }
  }

  reset() {
    this.spots.clear();
    this.grid.clear();
  }
}
