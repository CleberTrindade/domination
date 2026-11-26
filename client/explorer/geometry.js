import {geoArea} from 'd3-geo';
// D3 uses spherical ring winding. Normalize each island separately: reversing
// an entire MultiPolygon can turn correctly oriented islands into an ocean fill.
export function normalizeGeometry(feature){
 const g=feature?.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type))return feature;
 const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
 for(const polygon of polygons)for(const [index,ring]of polygon.entries()){
  const large=geoArea({type:'Polygon',coordinates:[ring]})>Math.PI*2;
  if(index===0?large:!large)ring.reverse();
 }
 return feature;
}
