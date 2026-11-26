// Keep every geographic anchor fixed. Crowded labels become discreet dots;
// polygon hit targets, keyboard navigation and the picker still expose all areas.
export function territoryMarkerLayout(points,selected){
 const markers=points.map(([x,y],index)=>({x,y,index,selected:index===selected,visible:false,radius:index===selected?12:9}));
 const placed=[];
 for(const marker of [...markers].sort((a,b)=>Number(b.selected)-Number(a.selected)||a.index-b.index)){
  if(!Number.isFinite(marker.x)||!Number.isFinite(marker.y))continue;
  if(marker.selected||placed.every(other=>Math.hypot(marker.x-other.x,marker.y-other.y)>=marker.radius+other.radius+4)){
   marker.visible=true;placed.push(marker);
  }
 }
 return markers;
}
