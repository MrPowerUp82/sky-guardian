import {
  staticMapScale, minimapRotation, toMinimap, clampToCircle, viewScale, worldToView
} from './map-math.js';

// Draws the city map. The static layer (terrain, roads, buildings) is rendered
// once into an offscreen canvas; the minimap and the full map only blit it and
// draw the live markers on top.
//
// state = { hero:{x,z}, aim:{x,z}, enemy:{x,z}|null, rings:[[x,z]], fires:[[x,z]], meteors:[{x,z,falling}] }

const COLORS = {
  outside: '#587a47', paved: '#a9aeb6', lawn: '#8bb369', park: '#4e8444', plaza: '#cdc6b4',
  road: '#434953', roadEdge: '#2c3037', dash: '#cfc896',
  lowRise: '#cfd4dc', highRise: '#f1f3f7', buildingEdge: 'rgba(55,64,80,.75)',
  limit: 'rgba(255,255,255,.55)',
  hero: '#ffffff', heroEdge: '#1d6dff', enemy: '#ff3b4d', ring: '#38e8ff', fire: '#ff9a2e', meteor: '#ff5a3c'
};

export class GameMap {
  /**
   * @param {{half:number, limit:number, roads:number[], roadWidth:number,
   *          blocks:{minX:number,maxX:number,minZ:number,maxZ:number,kind:string}[],
   *          buildings:{minX:number,maxX:number,minZ:number,maxZ:number,height:number}[]}} city
   * `half` is the world half-extent covered by the map, `limit` the playable edge.
   */
  constructor(city) {
    this.city = city;
    this.half = city.half;
    this.scale = staticMapScale(city.half * 2);
    this.static = null;
  }

  get ready() { return !!this.static; }

  buildStatic(createCanvas = () => document.createElement('canvas')) {
    const { half, scale, city } = this;
    const px = Math.ceil(half * 2 * scale);
    const canvas = createCanvas();
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, half * scale, half * scale);

    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(-half, -half, half * 2, half * 2);

    for (const b of city.blocks) {
      ctx.fillStyle = COLORS[b.kind] || COLORS.paved;
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }

    const extent = city.limit + 20;
    for (const r of city.roads) {
      ctx.fillStyle = COLORS.road;
      ctx.fillRect(r - city.roadWidth / 2, -extent, city.roadWidth, extent * 2);
      ctx.fillRect(-extent, r - city.roadWidth / 2, extent * 2, city.roadWidth);
    }
    ctx.strokeStyle = COLORS.dash;
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([6, 8]);
    for (const r of city.roads) {
      ctx.beginPath();
      ctx.moveTo(r, -extent); ctx.lineTo(r, extent);
      ctx.moveTo(-extent, r); ctx.lineTo(extent, r);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.lineWidth = .9 / scale;
    ctx.strokeStyle = COLORS.buildingEdge;
    for (const b of city.buildings) {
      const t = Math.min(1, b.height / 90);
      ctx.fillStyle = t > .55 ? COLORS.highRise : t > .25 ? mix(COLORS.lowRise, COLORS.highRise, (t - .25) / .3) : COLORS.lowRise;
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      ctx.strokeRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }

    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = COLORS.limit;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(-city.limit, -city.limit, city.limit * 2, city.limit * 2);
    ctx.setLineDash([]);
    this.static = canvas;
    return canvas;
  }

  // Heading-up circular minimap. `metres` is the visible radius.
  drawMinimap(canvas, state, metres = 170) {
    if (!this.static) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const R = size / 2;
    const ppm = R / metres;
    const rot = minimapRotation(state.aim.x, state.aim.z);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = COLORS.outside; ctx.fillRect(0, 0, size, size);
    ctx.translate(R, R); ctx.rotate(rot); ctx.scale(ppm, ppm); ctx.translate(-state.hero.x, -state.hero.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.static, -this.half, -this.half, this.half * 2, this.half * 2);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    const place = (x, z) => {
      const p = toMinimap(x - state.hero.x, z - state.hero.z, rot, ppm);
      const c = clampToCircle(p.x, p.y, R - size * .07);
      return { x: R + c.x, y: R + c.y, clamped: c.clamped, angle: c.angle };
    };
    this._markers(ctx, state, place, size * .035, false);
    ctx.restore();

    // North tick: where -z ended up after rotating.
    const n = toMinimap(0, -1, rot, 1);
    const na = Math.atan2(n.y, n.x);
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(size * .1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    const nx = R + Math.cos(na) * (R - size * .075), ny = R + Math.sin(na) * (R - size * .075);
    ctx.strokeText('N', nx, ny); ctx.fillText('N', nx, ny);

    ctx.beginPath(); ctx.arc(R, R, R - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    this._player(ctx, R, R, 0, size * .06);
  }

  // North-up pannable/zoomable full map.
  drawFull(canvas, view, state) {
    if (!this.static) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const k = viewScale(view, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.outside; ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2); ctx.scale(k, k); ctx.translate(-view.cx, -view.cz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.static, -this.half, -this.half, this.half * 2, this.half * 2);
    ctx.restore();

    const place = (x, z) => {
      const p = worldToView(view, size, x, z);
      return { x: p.x, y: p.y, clamped: false, angle: 0 };
    };
    this._markers(ctx, state, place, Math.max(5, size * .012), true);
    const h = worldToView(view, size, state.hero.x, state.hero.z);
    this._player(ctx, h.x, h.y, Math.atan2(state.aim.x, -state.aim.z), Math.max(8, size * .02));

    // Scale bar (100 m) and compass.
    const bar = 100 * k;
    ctx.fillStyle = 'rgba(8,16,32,.7)'; ctx.fillRect(10, size - 30, bar + 20, 20);
    ctx.fillStyle = '#fff'; ctx.fillRect(20, size - 16, bar, 3);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('100 m', 20, size - 19);
    ctx.textAlign = 'center'; ctx.font = '800 16px system-ui, sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText('N', size - 20, 22); ctx.fillText('N', size - 20, 22);
  }

  _markers(ctx, state, place, r, labelled) {
    for (const [x, z] of state.rings) {
      const p = place(x, z);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * .9, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, r * .4); ctx.strokeStyle = COLORS.ring; ctx.stroke();
    }
    for (const [x, z] of state.fires) {
      const p = place(x, z);
      flame(ctx, p.x, p.y, r * 1.25);
    }
    for (const m of state.meteors) {
      const p = place(m.x, m.z);
      const pulse = 1 + .25 * Math.sin(performance.now() / 160);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6 * pulse, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = COLORS.meteor; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, r * .7, 0, Math.PI * 2); ctx.fillStyle = COLORS.meteor; ctx.fill();
      if (labelled) label(ctx, p.x, p.y - r * 2.4, m.falling ? 'METEORO' : 'IMPACTO');
    }
    if (state.enemy) {
      const p = place(state.enemy.x, state.enemy.z);
      if (p.clamped) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(-r, r); ctx.lineTo(-r, -r); ctx.closePath();
        ctx.fillStyle = COLORS.enemy; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.enemy; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        if (labelled) label(ctx, p.x, p.y - r * 2, 'JASON');
      }
    }
  }

  _player(ctx, x, y, angle, size) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, -size * 1.15); ctx.lineTo(size * .8, size * .85); ctx.lineTo(0, size * .4); ctx.lineTo(-size * .8, size * .85); ctx.closePath();
    ctx.fillStyle = COLORS.hero; ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * .22); ctx.strokeStyle = COLORS.heroEdge; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
}

function mix(a, b, t) {
  const pa = parse(a), pb = parse(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function parse(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }

function flame(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.3);
  ctx.quadraticCurveTo(x + r * 1.1, y - r * .1, x + r * .7, y + r * .8);
  ctx.quadraticCurveTo(x, y + r * 1.2, x - r * .7, y + r * .8);
  ctx.quadraticCurveTo(x - r * 1.1, y - r * .1, x, y - r * 1.3);
  ctx.fillStyle = COLORS.fire; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#7a2a00'; ctx.stroke();
}

function label(ctx, x, y, text) {
  ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
}
