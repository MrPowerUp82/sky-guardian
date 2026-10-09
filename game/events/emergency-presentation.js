import * as THREE from 'three';

const v3 = v => new THREE.Vector3(v?.x||0,v?.y||0,v?.z||0);
// Big enough to read as a threat from across the city (it used to be 2.4 m).
const METEOR_RADIUS = 6.2;

function disposeEmergencyObject(root) {
  root?.traverse?.(node => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) material?.dispose?.();
  });
}

export class EmergencyPresentation {
  constructor({scene,camera,hudRoot,markerRoot}={}) {
    this.scene=scene; this.camera=camera;
    this.hudRoot=hudRoot || document?.querySelector?.('#event-hud') || null;
    this.markerRoot=markerRoot || document?.querySelector?.('#event-markers') || null;
    this.primary=this.hudRoot?.querySelector?.('#event-primary') || null;
    this.secondary=this.hudRoot?.querySelector?.('#event-secondary') || null;
    this.root=new THREE.Group(); this.root.name='dynamic-emergencies'; scene?.add?.(this.root);
    this.meteors=new Map(); this.fires=new Map(); this.markers=new Map();
    this._tmp=new THREE.Vector3(); this._tmp2=new THREE.Vector3(); this._q=new THREE.Quaternion();
    this._setupIceBreath(); this._setupPulsePool();
    this.audio=null;
  }

  _setupIceBreath() {
    const count=56, positions=new Float32Array(count*3), seeds=new Float32Array(count*3);
    for(let i=0;i<count;i++){seeds[i*3]=(i%7)/6;seeds[i*3+1]=(((i*13)%17)/16)-.5;seeds[i*3+2]=(((i*7)%19)/18)-.5;}
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const m=new THREE.PointsMaterial({color:0xd9f7ff,size:.18,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending});
    this.icePoints=new THREE.Points(g,m); this.icePoints.frustumCulled=false; this.icePoints.visible=false; this.root.add(this.icePoints);
    this.iceSeeds=seeds; this.icePositions=positions;
  }

  _setupPulsePool() {
    this.pulses=[];
    const geo=new THREE.RingGeometry(.8,1,40);
    for(let i=0;i<5;i++){
      const mat=new THREE.MeshBasicMaterial({color:0xffa04f,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
      const mesh=new THREE.Mesh(geo,mat); mesh.rotation.x=-Math.PI/2; mesh.visible=false; this.root.add(mesh);
      this.pulses.push({mesh,life:0});
    }
  }

  _makeMeteor() {
    const group=new THREE.Group();
    const core=new THREE.Mesh(new THREE.IcosahedronGeometry(METEOR_RADIUS,3),new THREE.MeshStandardMaterial({color:0x38241d,emissive:0xff3c0a,emissiveIntensity:2.3,roughness:.88}));
    core.scale.set(1,.9,1.08);
    group.add(core);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(METEOR_RADIUS*1.35,18,12),new THREE.MeshBasicMaterial({color:0xff6a25,transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false})); group.add(glow);
    const trailGeo=new THREE.BufferGeometry(); const arr=new Float32Array(24*3); trailGeo.setAttribute('position',new THREE.BufferAttribute(arr,3));
    const trail=new THREE.Line(trailGeo,new THREE.LineBasicMaterial({color:0xff8a3d,transparent:true,opacity:.72,blending:THREE.AdditiveBlending})); group.add(trail);
    group.userData.trailArray=arr; this.root.add(group); return group;
  }

  syncMeteor(snapshot) {
    if(!snapshot?.id) return;
    let view=this.meteors.get(snapshot.id); if(!view){view=this._makeMeteor();this.meteors.set(snapshot.id,view);}
    view.visible=!['intercepted','resolved'].includes(snapshot.state);
    const pos=v3(snapshot.position); view.position.copy(pos);
    const impact=v3(snapshot.impactPoint); const dir=this._tmp.copy(pos).sub(impact).normalize();
    const arr=view.userData.trailArray;
    for(let i=0;i<arr.length/3;i++){const d=i*3.4;arr[i*3]=dir.x*d;arr[i*3+1]=dir.y*d;arr[i*3+2]=dir.z*d;}
    view.children[2].geometry.attributes.position.needsUpdate=true;
    view.children[0].rotation.y+=.012; view.children[0].rotation.x+=.007;
  }

  removeMeteor(id,{exploded=false}={}) { const v=this.meteors.get(id); if(v){this.root.remove(v);disposeEmergencyObject(v);this.meteors.delete(id);} if(exploded&&v)this.pulseAirburst(v.position); }

  _makeFire() {
    const group=new THREE.Group();
    const flame=new THREE.Mesh(new THREE.ConeGeometry(.75,2.4,9),new THREE.MeshBasicMaterial({color:0xff7427,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending})); flame.position.y=1.15;
    const inner=new THREE.Mesh(new THREE.ConeGeometry(.42,1.55,8),new THREE.MeshBasicMaterial({color:0xffe29a,transparent:true,opacity:.92,depthWrite:false,blending:THREE.AdditiveBlending})); inner.position.y=.75;
    const smoke=new THREE.Mesh(new THREE.SphereGeometry(.9,10,8),new THREE.MeshBasicMaterial({color:0x33363d,transparent:true,opacity:.38,depthWrite:false})); smoke.position.y=2.5; smoke.scale.set(1,1.8,1);
    group.add(flame,inner,smoke); this.root.add(group); return group;
  }

  syncFires(spots=[]) {
    const seen=new Set();
    for(const spot of spots){
      seen.add(spot.id); let view=this.fires.get(spot.id); if(!view){view=this._makeFire();this.fires.set(spot.id,view);}
      view.position.copy(v3(spot.position));
      const intensity=Math.max(0,Math.min(1,spot.intensity??1)); view.visible=intensity>.01;
      view.scale.setScalar(.45+.8*intensity); view.children[0].material.opacity=.25+.7*intensity; view.children[1].material.opacity=.25+.72*intensity; view.children[2].material.opacity=.12+.3*intensity;
    }
    for(const [id,view] of [...this.fires]) if(!seen.has(id)){this.root.remove(view);disposeEmergencyObject(view);this.fires.delete(id);}
  }

  _ensureAudio() {
    if(this.audio || typeof window==='undefined') return;
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    const ctx=new AC(), osc=ctx.createOscillator(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
    osc.type='sawtooth'; osc.frequency.value=74; filter.type='lowpass'; filter.frequency.value=520; gain.gain.value=0;
    osc.connect(filter).connect(gain).connect(ctx.destination); osc.start(); this.audio={ctx,osc,filter,gain};
  }

  setIceBreath({active=false,origin,direction,intensity=1}={}) {
    this.icePoints.visible=!!active;
    if(active){
      this._ensureAudio(); const o=v3(origin), d=v3(direction).normalize(); const up=Math.abs(d.y)>.92?this._tmp.set(1,0,0):this._tmp.set(0,1,0); const right=this._tmp2.crossVectors(d,up).normalize(); const realUp=new THREE.Vector3().crossVectors(right,d).normalize();
      for(let i=0;i<this.icePositions.length/3;i++){const t=.6+this.iceSeeds[i*3]*20,spread=.15+t*.055;const x=o.x+d.x*t+right.x*this.iceSeeds[i*3+1]*spread+realUp.x*this.iceSeeds[i*3+2]*spread;const y=o.y+d.y*t+right.y*this.iceSeeds[i*3+1]*spread+realUp.y*this.iceSeeds[i*3+2]*spread;const z=o.z+d.z*t+right.z*this.iceSeeds[i*3+1]*spread+realUp.z*this.iceSeeds[i*3+2]*spread;this.icePositions.set([x,y,z],i*3);}
      this.icePoints.geometry.attributes.position.needsUpdate=true; this.icePoints.material.opacity=.38+.48*Math.max(0,Math.min(1,intensity));
      if(this.audio){this.audio.ctx.resume?.();this.audio.gain.gain.setTargetAtTime(.055*Math.max(.2,intensity),this.audio.ctx.currentTime,.035);}
    } else if(this.audio) this.audio.gain.gain.setTargetAtTime(0,this.audio.ctx.currentTime,.05);
  }

  _pulse(point,color,strength=1){const p=this.pulses.find(x=>x.life<=0)||this.pulses[0];p.life=1;p.mesh.visible=true;p.mesh.position.copy(v3(point));p.mesh.scale.setScalar(Math.max(.5,strength));p.mesh.material.color.setHex(color);p.mesh.material.opacity=.72;}
  pulseImpact(point,{strength=1}={}){this._pulse(point,0xff6f32,strength);}
  pulseAirburst(point){this._pulse(point,0xffd18a,1.4);}

  updateEffects(dt=1/60){for(const p of this.pulses){if(p.life<=0)continue;p.life=Math.max(0,p.life-dt*2.2);p.mesh.scale.multiplyScalar(1+dt*5);p.mesh.material.opacity=p.life*.65;p.mesh.visible=p.life>0;}}

  updateHud(snapshots=[],heroPosition={x:0,y:0,z:0}) {
    if(!this.hudRoot) return;
    const active=snapshots.filter(s=>s && s.state!=='resolved' && s.state!=='intercepted');
    active.sort((a,b)=>(b.priority||0)-(a.priority||0)); const s=active[0];
    if(!s){this.hudRoot.className='';this.primary&&(this.primary.textContent='');this.secondary&&(this.secondary.textContent='');return;}
    this.hudRoot.className=`active ${s.type==='meteor'?'meteor':'fire'}`;
    const target=s.position||s.impactPoint; const distance=target?Math.round(v3(target).distanceTo(v3(heroPosition))):null;
    if(s.type==='meteor' && (s.state==='warning'||s.state==='falling')) { if(this.primary)this.primary.textContent='METEORO DETECTADO'; if(this.secondary)this.secondary.textContent=`${distance??'—'} m · IMPACTO EM ${Math.max(0,s.eta||0).toFixed(1)}s · DESTRUA: SUPERVELOCIDADE · SUPER SOCO`; }
    else if(s.type==='meteor'){if(this.primary)this.primary.textContent='IMPACTO · APAGUE OS INCÊNDIOS';if(this.secondary)this.secondary.textContent=`${s.fireIds?.length||0} FOCOS VINCULADOS`;}
    else {if(this.primary)this.primary.textContent='INCÊNDIO EM PRÉDIO';if(this.secondary)this.secondary.textContent=`${distance!=null?distance+' m · ':''}${s.fireIds?.length||0} FOCOS VINCULADOS`;}
  }

  _markerFor(id,type){let el=this.markers.get(id);if(el||!this.markerRoot)return el;el=document.createElement('div');el.className=`event-marker ${type==='meteor'?'meteor':'fire'}`;el.innerHTML='<span class="label"></span><span class="distance"></span>';this.markerRoot.appendChild(el);this.markers.set(id,el);return el;}
  updateMarkers(snapshots=[],camera=this.camera,viewport={width:innerWidth,height:innerHeight},heroPosition=null){
    const live=new Set(); if(!camera||!this.markerRoot)return;
    for(const s of snapshots){if(!s||['resolved','intercepted'].includes(s.state))continue;const target=s.position||s.impactPoint;if(!target)continue;live.add(s.id);const el=this._markerFor(s.id,s.type);if(!el)continue;const p=v3(target),ndc=p.clone().project(camera),behind=ndc.z>1;let x=(ndc.x*.5+.5)*viewport.width,y=(-ndc.y*.5+.5)*viewport.height;const margin=48;const off=behind||x<margin||x>viewport.width-margin||y<margin||y>viewport.height-margin;const rawX=x,rawY=y;x=Math.max(margin,Math.min(viewport.width-margin,x));y=Math.max(margin,Math.min(viewport.height-margin,y));el.style.left=`${x}px`;el.style.top=`${y}px`;el.classList.toggle('offscreen',off);if(off)el.style.setProperty('--arrow-angle',`${Math.atan2(rawY-viewport.height/2,rawX-viewport.width/2)}rad`);el.querySelector('.label').textContent=s.type==='meteor'?'METEORO':'INCÊNDIO';if(heroPosition)el.querySelector('.distance').textContent=`${Math.round(p.distanceTo(v3(heroPosition)))}m`;}
    for(const [id,el] of [...this.markers])if(!live.has(id)){el.remove();this.markers.delete(id);}
  }

  reset(){
    for(const v of this.meteors.values()){this.root.remove(v);disposeEmergencyObject(v);}this.meteors.clear();
    for(const v of this.fires.values()){this.root.remove(v);disposeEmergencyObject(v);}this.fires.clear();
    for(const el of this.markers.values())el.remove();this.markers.clear();
    this.setIceBreath({active:false}); for(const p of this.pulses){p.life=0;p.mesh.visible=false;}
    if(this.hudRoot)this.hudRoot.className='';
  }
}

export { METEOR_RADIUS };
