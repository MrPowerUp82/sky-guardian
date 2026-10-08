const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const center=b=>({x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2});
const distanceXZ=(a,b)=>Math.hypot((a?.x||0)-(b?.x||0),(a?.z||0)-(b?.z||0));

export function selectBuildingTarget(buildings,{heroPosition={x:0,y:0,z:0},activeBuildingIds=[],recentBuildingIds=[],rng=Math.random,minHeroDistance=70}={}) {
  const blocked=new Set([...activeBuildingIds,...recentBuildingIds].map(String));
  const candidates=(buildings||[]).filter(b=>b?.id!=null && b.min && b.max && !blocked.has(String(b.id)) && distanceXZ(center(b),heroPosition)>=minHeroDistance);
  if(!candidates.length) return null;
  const r=clamp(Number(rng?.())||0,0,.999999999);
  return candidates[Math.floor(r*candidates.length)] || null;
}

export function createBuildingFireSpots({eventId,building,count,rng=Math.random}={}) {
  if(!building?.min||!building?.max) return [];
  const n=clamp(Math.floor(Number(count)||0),1,3);
  const min=building.min,max=building.max;
  const width=Math.max(.01,max.x-min.x),depth=Math.max(.01,max.z-min.z),height=Math.max(.01,max.y-min.y);
  const marginX=Math.min(1.5,width*.15), marginZ=Math.min(1.5,depth*.15), marginY=Math.min(1.2,height*.12);
  const range=(a,b,r)=>a+(b-a)*clamp(Number(r)||0,0,1);
  const out=[];
  for(let i=0;i<n;i++) {
    const face=Math.floor(clamp(Number(rng?.())||0,0,.999999)*5);
    const r1=rng?.() ?? .5, r2=rng?.() ?? .5;
    let position,normal;
    if(face===0){ // roof
      position={x:range(min.x+marginX,max.x-marginX,r1),y:max.y,z:range(min.z+marginZ,max.z-marginZ,r2)};
      normal={x:0,y:1,z:0};
    } else if(face===1){
      position={x:max.x,y:range(min.y+marginY,max.y-marginY,r1),z:range(min.z+marginZ,max.z-marginZ,r2)};
      normal={x:1,y:0,z:0};
    } else if(face===2){
      position={x:min.x,y:range(min.y+marginY,max.y-marginY,r1),z:range(min.z+marginZ,max.z-marginZ,r2)};
      normal={x:-1,y:0,z:0};
    } else if(face===3){
      position={x:range(min.x+marginX,max.x-marginX,r1),y:range(min.y+marginY,max.y-marginY,r2),z:max.z};
      normal={x:0,y:0,z:1};
    } else {
      position={x:range(min.x+marginX,max.x-marginX,r1),y:range(min.y+marginY,max.y-marginY,r2),z:min.z};
      normal={x:0,y:0,z:-1};
    }
    out.push({
      id:`${eventId}:fire:${i+1}`,
      eventId,buildingId:building.id,source:'building-fire',position,normal,radius:2,intensity:1,
    });
  }
  return out;
}

export class BuildingFireEvent {
  constructor({id,buildingId}={}) {
    if(!id) throw new Error('id required');
    this.id=String(id); this.type='building-fire'; this.buildingId=String(buildingId ?? '');
    this.state='active'; this.fireIds=[]; this._resolvedEmitted=false;
  }
  attachFireIds(ids=[]){this.fireIds=[...new Set(ids.filter(Boolean).map(String))];}
  getSnapshot(){return {id:this.id,type:this.type,state:this.state,buildingId:this.buildingId,fireIds:[...this.fireIds],priority:this.state==='active'?60:0};}
  update(_dt,{remainingFires=0}={}){
    if(this.state!=='active'||this._resolvedEmitted) return [];
    if(Number(remainingFires)>0) return [];
    this._resolvedEmitted=true; this.state='resolved';
    return [{type:'building-fire-resolved',eventId:this.id,buildingId:this.buildingId}];
  }
  reset(){this.state='resolved';this._resolvedEmitted=true;this.fireIds=[];}
  dispose(){this.reset();}
}
