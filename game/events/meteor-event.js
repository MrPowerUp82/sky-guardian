const clone = v => ({x:Number(v?.x)||0,y:Number(v?.y)||0,z:Number(v?.z)||0});
const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

export class MeteorEvent {
  constructor({ id, impactPoint, startPosition, warningSeconds = 1.5, fallSeconds = 12, fireCount } = {}) {
    if (!id) throw new Error('id required');
    if (!Number.isInteger(fireCount) || fireCount < 3 || fireCount > 6) throw new Error('fireCount must be an integer 3..6');
    this.id=String(id);
    this.type='meteor';
    this.impactPoint=clone(impactPoint);
    this.startPosition=clone(startPosition);
    this.position=clone(startPosition);
    this.warningSeconds=Math.max(0,Number(warningSeconds)||0);
    this.fallSeconds=Math.max(.001,Number(fallSeconds)||12);
    this.fireCount=fireCount;
    this.state='warning';
    this.warningElapsed=0;
    this.fallElapsed=0;
    this.fireIds=[];
    this._impactEmitted=false;
    this._resolvedEmitted=false;
  }

  getSnapshot() {
    let eta=0;
    if (this.state==='warning') eta=Math.max(0,this.warningSeconds-this.warningElapsed)+this.fallSeconds;
    else if (this.state==='falling') eta=Math.max(0,this.fallSeconds-this.fallElapsed);
    return {
      id:this.id,type:'meteor',state:this.state,position:clone(this.position),impactPoint:clone(this.impactPoint),
      eta,fireIds:[...this.fireIds],priority:(this.state==='warning'||this.state==='falling')?100:this.state==='impacted'?90:0,
    };
  }

  update(dt,{remainingFires=0}={}) {
    if (['intercepted','resolved'].includes(this.state)) return [];
    let remaining=Math.max(0,Number(dt)||0);
    const commands=[];
    if (this.state==='warning') {
      const need=Math.max(0,this.warningSeconds-this.warningElapsed);
      const used=Math.min(remaining,need);
      this.warningElapsed+=used;
      remaining-=used;
      if (this.warningElapsed+1e-9>=this.warningSeconds) this.state='falling';
      else return commands;
    }
    if (this.state==='falling') {
      this.fallElapsed=Math.min(this.fallSeconds,this.fallElapsed+remaining);
      const t=Math.min(1,this.fallElapsed/this.fallSeconds);
      this.position=lerp(this.startPosition,this.impactPoint,t);
      if (t>=1 && !this._impactEmitted) {
        this._impactEmitted=true;
        this.state='impacted';
        commands.push({type:'meteor-impact',eventId:this.id,point:clone(this.impactPoint),requestedFireCount:this.fireCount});
      }
      return commands;
    }
    if (this.state==='impacted' && Number(remainingFires)<=0 && !this._resolvedEmitted) {
      this._resolvedEmitted=true;
      this.state='resolved';
      commands.push({type:'meteor-resolved',eventId:this.id});
    }
    return commands;
  }

  tryIntercept({method,speed=0,machOne=343}={}) {
    if (this.state!=='falling') return [];
    if (method!=='superPunch' && method!=='supersonic') return [];
    if (method==='supersonic' && Number(speed)<Number(machOne)) return [];
    this.state='intercepted';
    return [{type:'meteor-intercepted',eventId:this.id,position:clone(this.position)}];
  }

  attachFireIds(ids=[]) { this.fireIds=[...new Set(ids.filter(Boolean).map(String))]; }
  reset() { this.state='resolved'; this.fireIds=[]; this._resolvedEmitted=true; }
  dispose() { this.reset(); }
}
