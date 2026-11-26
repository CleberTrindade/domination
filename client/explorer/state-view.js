import {municipalAreas} from './territories.js';
import {territoryMarkerLayout} from './marker-layout.js';
import {geoPath} from 'd3-geo';
export function stateSceneAnchors(w,h){return [[.42,.79],[.48,.53],[.27,.17],[.73,.35],[.69,.66]].map(([x,y])=>[x*w,y*h]);}
export function createStateView(){
 let cached=null;
 return {draw(ctx,{width:w,height:h,projection,feature,contextFeatures=[],locations,selected,texture}){
  const key=[feature.id,feature.properties.name,w,h,projection.scale(),...projection.translate(),...projection.rotate()].join(':');
  if(cached?.key!==key||cached.feature!==feature){const points=locations.map(p=>projection(p));cached={key,feature,points};}
  const areas=municipalAreas(feature);
  const {points}=cached,cells=areas??[],count=points.length;
  const path=()=>{ctx.beginPath();geoPath(projection,ctx)(feature);};
  ctx.save();const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#154666');bg.addColorStop(1,'#092a4a');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  // Neighboring regions supply geographic context without changing the selected outline.
  if(contextFeatures.length){ctx.beginPath();geoPath(projection,ctx)({type:'FeatureCollection',features:contextFeatures});ctx.fillStyle='#75949a18';ctx.fill();ctx.strokeStyle='#a0c6cc28';ctx.lineWidth=.7;ctx.stroke();}
  ctx.save();ctx.translate(0,6);path();ctx.fillStyle='#195970';ctx.fill();ctx.strokeStyle='#48c9e5';ctx.lineWidth=3;ctx.stroke();ctx.restore();
  path();ctx.shadowColor='#00c8ec';ctx.shadowBlur=7;ctx.strokeStyle='#9df2ff';ctx.lineWidth=3;ctx.stroke();ctx.shadowBlur=0;
  ctx.save();path();ctx.clip();
  const land=ctx.createLinearGradient(0,0,w,h);land.addColorStop(0,'#41776b');land.addColorStop(1,'#1a4746');ctx.fillStyle=land;ctx.fillRect(0,0,w,h);
  if(texture)ctx.drawImage(texture,0,0,w,h);
  if(areas)for(const a of areas)if(a.properties.owner){ctx.beginPath();geoPath(projection,ctx)(a);ctx.fillStyle=a.properties.mine?'#178fff66':'#dd545455';ctx.fill();}
  const polygon=p=>{ctx.beginPath();geoPath(projection,ctx)(p);};
  for(const area of cells){polygon(area);ctx.strokeStyle='#eeffcc80';ctx.lineWidth=1;ctx.stroke();}
  if(cells[selected]){polygon(cells[selected]);ctx.strokeStyle='#ffda61';ctx.lineWidth=2;ctx.shadowColor='#ffda61';ctx.shadowBlur=3;ctx.stroke();ctx.shadowBlur=0;}
  ctx.restore();path();ctx.strokeStyle='#c2eff4';ctx.lineWidth=1.3;ctx.stroke();
  for(const marker of territoryMarkerLayout(points,selected)){
   const {x,y,index:i,selected:active,visible}=marker;
   if(!visible){ctx.fillStyle='#e0f6de80';ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();continue;}
   ctx.save();ctx.translate(x,y);ctx.textAlign='center';ctx.textBaseline='middle';
   if(active){ctx.fillStyle='#174d3de6';ctx.strokeStyle='#ffe680';ctx.lineWidth=1.3;ctx.beginPath();ctx.roundRect(-12,-12,24,24,7);ctx.fill();ctx.stroke();}
   ctx.font=(active?'700 15px':'600 13px')+' system-ui';
   if(!active){ctx.strokeStyle='#092b3dcc';ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeText(String(i+1),0,.5);}
   if(areas?.[i]?.properties.battle){ctx.fillStyle='#ffd875';ctx.font='bold 13px system-ui';ctx.fillText('⚔',12,-13);}
   ctx.fillStyle=active?'#fff7d5':'#f0f8eadb';ctx.fillText(String(i+1),0,.5);ctx.restore();
  }
  ctx.restore();return points;
 }};
}
