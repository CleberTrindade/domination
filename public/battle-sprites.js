/* Raster copies of the approved models. Only sheets actually used are decoded. */
(function(root){
  'use strict';
  const manifest=root.DOMINATION_SPRITE_MANIFEST,sheets=new Map(),entries=new Map();
  if(!manifest)return;
  function sprite(key,index){
    const meta=manifest.atlases[key];if(!meta)return null;
    let sheet=sheets.get(key);
    if(!sheet){
      sheet={ok:false,failed:false,im:new Image()};sheets.set(key,sheet);
      sheet.im.decoding='async';
      sheet.im.onload=()=>{if(sheet.im.decode)sheet.im.decode().then(()=>{sheet.ok=true;},()=>{sheet.failed=true;});else sheet.ok=true;};sheet.im.onerror=()=>{sheet.failed=true;};
      sheet.im.src='/art/battle-sprites/'+meta.file;
    }
    if(sheet.failed)return null; // The existing SVG renderer remains the fallback.
    const id=key+':'+index;let entry=entries.get(id);
    if(!entry){entry={vb:meta.vb,im:sheet.im,sx:index%meta.cols*meta.w,sy:Math.floor(index/meta.cols)*meta.h,sw:meta.w,sh:meta.h,get ok(){return sheet.ok;}};entries.set(id,entry);}
    return entry;
  }
  const direction=h=>((Math.round(h/(2*Math.PI)*32)%32)+32)%32;
  root.DOMINATION_BATTLE_SPRITES={
    building(kind,col){const index=manifest.bases.indexOf(kind);return index<0?null:sprite('bases'+col,index);},
    turret:(col,h)=>sprite('turret'+col,direction(h)),
    unit:(kind,col,h)=>sprite(kind+col,direction(h))
  };
})(window);
