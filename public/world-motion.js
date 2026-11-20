(function(root){
  'use strict';
  // Presentation only: interpolate travelled distance along the server's route.
  // Never extrapolate or change the authoritative units used by game logic.
  function createWorldMotion(){
    let tracks=new Map(),lastAt=null,lastTime=null;
    function distance(track,now){
      const progress=Math.max(0,Math.min(1,(now-track.at)/track.duration));
      return track.from+(track.to-track.from)*progress;
    }
    return {
      receive(units,time,now,snap=false){
        const elapsed=lastTime==null?0:(time-lastTime)*1000;
        const reset=snap||lastAt==null||now-lastAt>1000||elapsed<0;
        const duration=Math.max(50,Math.min(250,elapsed||200));
        const next=new Map();
        for(const unit of units){
          const old=tracks.get(unit.id);
          const from=!reset&&old?distance(old,now):unit.d;
          next.set(unit.id,{from,to:unit.d,at:now,duration,visual:old?.visual||{}});
        }
        tracks=next;lastAt=now;lastTime=time;
      },
      sample(units,now){
        const visuals=units.map(unit=>{
          const track=tracks.get(unit.id);
          if(!track)return {...unit};
          const visual=Object.assign(track.visual,unit,{fight:null});
          visual.d=distance(track,now);
          if(visual.d!==unit.d){
            let i=0;
            while(i<unit.P.length-2&&visual.d>unit.cum[i+1])i++;
            const a=unit.P[i],b=unit.P[i+1]||a;
            const fraction=Math.max(0,Math.min(1,(visual.d-unit.cum[i])/((unit.cum[i+1]-unit.cum[i])||1)));
            visual.x=a[0]+(b[0]-a[0])*fraction;
            visual.y=a[1]+(b[1]-a[1])*fraction;
            visual.si=i;
          }
          return visual;
        });
        const byId=new Map(visuals.map(unit=>[unit.id,unit]));
        for(const unit of visuals)if(unit.fighting!=null&&byId.has(unit.fighting))unit.fight={a:unit,b:byId.get(unit.fighting)};
        return {units:visuals,byId};
      }
    };
  }
  if(typeof module==='object'&&module.exports)module.exports={createWorldMotion};
  else root.createWorldMotion=createWorldMotion;
})(typeof window==='object'?window:globalThis);
