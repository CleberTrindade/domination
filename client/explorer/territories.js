import {SERGIPE_AREAS} from './sergipe-areas.js';
import {normalizeGeometry} from './geometry.js';
import {geoArea,geoBounds,geoContains} from 'd3-geo';
const registered=new WeakMap();
export {populationTier,POPULATION_BANDS} from './population.js';
import {populationTier} from './population.js';
export function territoryCount(region){return populationTier(region.properties?.population);}
export function municipalAreas(region){const data=registered.get(region)??(region.id==='BR-SE'?SERGIPE_AREAS:null);return data?.length===territoryCount(region)?data:null;}
export function registerMunicipalAreas(region,data){
 if(!Array.isArray(data.features)||data.features.length!==territoryCount(region))throw Error('Invalid municipal area count');
 const areas=data.features.map(normalizeGeometry);registered.set(region,areas);cache.delete(region);
 if(data.outline)region.geometry=normalizeGeometry(data.outline).geometry;
 return areas;
}
export function regionAreaKm2(region){return geoArea(region)*6371.0088**2;}
export const SERGIPE_POINTS=SERGIPE_AREAS.map(f=>f.properties.label);
const cache=new WeakMap();
function halton(n,base){let value=0,factor=1;while(n){factor/=base;value+=factor*(n%base);n=Math.floor(n/base);}return value;}
export function territoryLocations(region){
 const municipal=municipalAreas(region);if(municipal){if(!cache.has(region))cache.set(region,municipal.map(f=>f.properties.label));return cache.get(region);}
 if(cache.has(region))return cache.get(region);
 const count=territoryCount(region),candidates=[];
 const geometry=region.geometry,parts=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 const boxes=parts.map(coordinates=>{const feature={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates}},bounds=geoBounds(feature);return {feature,bounds,area:geoArea(feature)};}).sort((a,b)=>b.area-a.area);
 const total=boxes.reduce((sum,b)=>sum+b.area,0);
 // Sample individual islands to avoid empty-ocean rejection in sparse archipelagos.
 for(let n=1;candidates.length<Math.max(count*4,32)&&n<20000;n++){
  let weight=halton(n,5)*total,box=boxes[boxes.length-1];for(const b of boxes){weight-=b.area;if(weight<=0){box=b;break;}}
  const [[west,south],[east,north]]=box.bounds,span=east>=west?east-west:east+360-west;
  const raw=west+span*halton(n,2),s=Math.sin(south*Math.PI/180),t=Math.sin(north*Math.PI/180);
  const point=[((raw+180)%360+360)%360-180,Math.asin(Math.max(-1,Math.min(1,s+(t-s)*halton(n,3))))*180/Math.PI];
  if(geoContains(region,point))candidates.push(point);
 }
 if(candidates.length<count)throw Error('Not enough interior territory seeds');
 const vectors=candidates.map(([lon,lat])=>{const a=lon*Math.PI/180,b=lat*Math.PI/180;return [Math.cos(b)*Math.cos(a),Math.cos(b)*Math.sin(a),Math.sin(b)];});
 const distances=new Float64Array(candidates.length).fill(Infinity),used=new Uint8Array(candidates.length),chosen=[];let next=0;
 // Farthest-point sampling spreads cells across the actual landmass. Cache it
 // per region, independently of camera movement and selection.
 for(let k=0;k<count;k++){
  chosen.push(candidates[next]);used[next]=1;const p=vectors[next];let best=-1;
  for(let i=0;i<candidates.length;i++){if(used[i])continue;const q=vectors[i],d=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;distances[i]=Math.min(distances[i],d);if(distances[i]>best){best=distances[i];next=i;}}
 }
 cache.set(region,chosen);return chosen;
}
