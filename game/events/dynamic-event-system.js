export const DEFAULT_EVENT_TUNING = Object.freeze({
  initialCalm:[30,45],
  buildingFireWindow:[45,90],
  meteorWindow:[120,210],
  minGapSeconds:20,
  retrySeconds:15,
  maxMeteors:1,
  maxBuildingFireEvents:2,
  maxFireSpots:12,
});

const cloneTuning=t=>({
  ...DEFAULT_EVENT_TUNING,
  ...t,
  initialCalm:[...(t?.initialCalm||DEFAULT_EVENT_TUNING.initialCalm)],
  buildingFireWindow:[...(t?.buildingFireWindow||DEFAULT_EVENT_TUNING.buildingFireWindow)],
  meteorWindow:[...(t?.meteorWindow||DEFAULT_EVENT_TUNING.meteorWindow)],
});

export class DynamicEventSystem {
  constructor({rng=Math.random,factories={},tuning=DEFAULT_EVENT_TUNING}={}) {
    this.rng=rng;
    this.factories=factories;
    this.tuning=cloneTuning(tuning);
    this.events=[];
    this.pauseReasons=new Set();
    this._resetClocks();
  }

  _randWindow([a,b]) {
    const lo=Math.min(Number(a)||0,Number(b)||0), hi=Math.max(Number(a)||0,Number(b)||0);
    const r=Math.max(0,Math.min(.999999999,Number(this.rng?.())||0));
    return lo+(hi-lo)*r;
  }
  _resetClocks(){
    this.calmRemaining=this._randWindow(this.tuning.initialCalm);
    this.fireTimer=this._randWindow(this.tuning.buildingFireWindow);
    this.meteorTimer=this._randWindow(this.tuning.meteorWindow);
    this.gapRemaining=0;
  }
  get paused(){return this.pauseReasons.size>0;}
  pause(reason){if(reason)this.pauseReasons.add(String(reason));}
  resume(reason){if(reason)this.pauseReasons.delete(String(reason));}
  getActiveEvents(){return [...this.events];}
  getSnapshots(){return this.events.map(e=>e.getSnapshot?.()).filter(Boolean);}
  countType(type){
    const normalized=type==='buildingFire'?'building-fire':type;
    return this.events.filter(e=>e.type===normalized && e.state!=='resolved').length;
  }

  spawn(type,options={}) {
    if(type==='meteor') {
      if(this.countType('meteor')>=this.tuning.maxMeteors) return null;
      const event=this.factories.meteor?.(options) || null;
      if(event) this.events.push(event);
      return event;
    }
    if(type==='buildingFire'||type==='building-fire') {
      if(this.countType('building-fire')>=this.tuning.maxBuildingFireEvents) return null;
      const event=this.factories.buildingFire?.(options) || null;
      if(event) this.events.push(event);
      return event;
    }
    return null;
  }

  _autoSpawn(type,context) {
    if(type==='buildingFire' && Number(context?.activeFireSpots||0)>=this.tuning.maxFireSpots) return null;
    const event=this.spawn(type,{automatic:true,context});
    if(event) this.gapRemaining=Math.max(0,this.tuning.minGapSeconds);
    return event;
  }

  update(dt,context={}) {
    if(this.paused) return [];
    const step=Math.max(0,Number(dt)||0);
    const commands=[];

    for(const event of [...this.events]) {
      const remainingFires=typeof context.remainingFires==='function' ? context.remainingFires(event.id) : 0;
      const result=event.update?.(step,{...context,remainingFires});
      if(Array.isArray(result)) commands.push(...result);
      if(event.state==='resolved') this.events=this.events.filter(e=>e!==event);
    }

    if(this.calmRemaining>0) {
      this.calmRemaining=Math.max(0,this.calmRemaining-step);
      return commands;
    }

    this.fireTimer-=step;
    this.meteorTimer-=step;
    this.gapRemaining=Math.max(0,this.gapRemaining-step);
    if(this.gapRemaining < 1e-9) this.gapRemaining = 0;
    if(this.gapRemaining>0) return commands;

    if(this.fireTimer<=1e-9) {
      const event=this._autoSpawn('buildingFire',context);
      this.fireTimer=event ? this._randWindow(this.tuning.buildingFireWindow) : Math.max(0,this.tuning.retrySeconds);
      if(event) return commands;
    }
    if(this.meteorTimer<=1e-9 && this.gapRemaining<=0) {
      const event=this._autoSpawn('meteor',context);
      this.meteorTimer=event ? this._randWindow(this.tuning.meteorWindow) : Math.max(0,this.tuning.retrySeconds);
    }
    return commands;
  }

  reset() {
    for(const event of this.events) event.dispose?.();
    this.events=[];
    this.pauseReasons.clear();
    this._resetClocks();
  }
}
