/* Pointer selection is presentation state; commands remain authoritative. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.installBattleInput=factory().installBattleInput;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function installBattleInput({canvas,getGame,toMap,hit,playable,pointers,send,drop,spectate,pan,viewport}){
    const selected=g=>{
      if(!g.selectedSites)g.selectedSites=new Set();
      for(const site of g.selectedSites)if(site.owner!==g.me)g.selectedSites.delete(site);
      return g.selectedSites;
    };
    const collect=(g,owner)=>{
      const sites=new Set(g.mode==='local'?[]:selected(g));
      for(const p of pointers.values())if(p.owner===owner&&!p.consumed)for(const s of p.sel)if(s.owner===owner)sites.add(s);
      return [...sites];
    };
    const release=id=>{pointers.delete(id);try{canvas.releasePointerCapture(id);}catch{}};
    const sample=(p,point)=>{
      const previous=p.ptr;p.ptr=point;
      // Sample the full segment, including movement caused by the camera.
      const steps=Math.max(1,Math.ceil(Math.hypot(point.x-previous.x,point.y-previous.y)/8));
      for(let i=1;i<=steps;i++){
        const site=hit({x:previous.x+(point.x-previous.x)*i/steps,y:previous.y+(point.y-previous.y)*i/steps});
        if(site?.owner===p.owner&&!p.sel.includes(site))p.sel.push(site);
      }
    };
    canvas.addEventListener('pointerdown',e=>{
      const g=getGame();if(!g||!playable(g)||e.button>0)return;
      e.preventDefault?.();
      const point=toMap(e),site=hit(point),owner=g.mode==='local'?site?.owner:g.me;
      if(g.mode==='local'&&(!site||!g.mine.includes(owner)))return;
      try{canvas.setPointerCapture(e.pointerId);}catch{}
      const selection=g.mode==='local'?[]:collect(g,owner);
      const record={game:g,owner,sel:selection,ptr:point,start:{x:e.clientX,y:e.clientY},down:site,moved:false,
        wasSelected:g.mode!=='local'&&selected(g).has(site),drop:g.dropMode,spectator:g.mode==='world'&&g.me===0};
      record.pan=!!pan&&g.mode==='world'&&!!g.L?.geometry.scroll&&!g.dropMode&&(!site||g.cameraMode);record.lastScreen={x:e.clientX,y:e.clientY};
      if(site?.owner===owner&&!record.sel.includes(site))record.sel.push(site);
      pointers.set(e.pointerId,record);
    });
    canvas.addEventListener('pointermove',e=>{
      const g=getGame(),p=pointers.get(e.pointerId);if(!g||!p||p.consumed)return;
      e.preventDefault?.();
      if(p.pan){const dx=e.clientX-p.lastScreen.x,dy=e.clientY-p.lastScreen.y;p.lastScreen={x:e.clientX,y:e.clientY};if(Math.hypot(e.clientX-p.start.x,e.clientY-p.start.y)>=8)p.moved=true;if(p.moved)pan(dx,dy);return;}
      const point=toMap(e);p.lastScreen={x:e.clientX,y:e.clientY};
      if(Math.hypot(e.clientX-p.start.x,e.clientY-p.start.y)>=8)p.moved=true;
      if(!p.moved||p.spectator||p.drop){p.ptr=point;return;}
      sample(p,point);
    });
    canvas.addEventListener('pointerup',e=>{
      const g=getGame(),p=pointers.get(e.pointerId);if(!g||!p){release(e.pointerId);return;}
      try{
        if(!playable(g)||p.consumed)return;
        e.preventDefault?.();const site=hit(toMap(e),p.moved?36:26);
        if(p.pan){if(!p.moved&&!site)selected(g).clear();return;}
        if(p.spectator){if(!p.moved&&site)spectate(site.id);return;}
        if(p.drop){if(site?.owner===g.me)drop(g.me,site);g.dropMode=false;return;}
        if(!p.moved&&site===p.down&&site?.owner===p.owner){
          if(g.mode!=='local'){const selection=selected(g);if(p.wasSelected)selection.delete(site);else selection.add(site);}
          return;
        }
        if(site){
          const sources=[...new Set([...p.sel,...collect(g,p.owner)])].filter(s=>s!==site&&s.owner===p.owner);
          if(sources.length){
            const accepted=send(p.owner,sources,site);
            if(accepted!==false){selected(g).clear();for(const other of pointers.values())if(other.owner===p.owner)other.consumed=true;}
          }
        }else if(!p.moved&&g.mode!=='local')selected(g).clear();
      }finally{release(e.pointerId);}
    });
    for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>release(e.pointerId));
    return {
      update(dt){
        const g=getGame();if(!pan||!viewport||!g||g.mode!=='world'||!g.L?.geometry.scroll||!playable(g)||g.cameraMode||g.dropMode)return;
        // One leading pointer controls the camera; other fingers retain their bases.
        const active=[...pointers.values()].filter(p=>p.game===g&&p.owner===g.me&&!p.consumed&&!p.pan&&!p.spectator&&!p.drop&&p.moved&&p.sel.some(s=>s.owner===p.owner));
        const lead=active[active.length-1];if(!lead)return;
        const r=viewport();if(!r||r.width<=0||r.height<=0)return;
        const margin=Math.min(56,r.width*.14,r.height*.14),edge=(value,start,length)=>value<start+margin?-Math.min(1,(start+margin-value)/margin):value>start+length-margin?Math.min(1,(value-start-length+margin)/margin):0;
        let x=edge(lead.lastScreen.x,r.left,r.width),y=edge(lead.lastScreen.y,r.top,r.height);const length=Math.hypot(x,y);if(!length)return;if(length>1){x/=length;y/=length;}
        const distance=420*Math.max(0,Math.min(.05,dt));if(!distance)return;
        pan(-x*distance,-y*distance);
        // A stationary finger still sweeps newly revealed bases as the field moves.
        for(const p of pointers.values())if(p.game===g&&!p.consumed&&!p.pan&&!p.spectator&&!p.drop){
          const point=toMap({clientX:p.lastScreen.x,clientY:p.lastScreen.y});if(p.moved)sample(p,point);else p.ptr=point;
        }
      },
      clear(){for(const id of [...pointers.keys()])release(id);const g=getGame();if(g)selected(g).clear();}
    };
  }
  return {installBattleInput};
});
