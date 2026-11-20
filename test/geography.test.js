'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const map=require('../public/sergipe-map');
test('every campaign marker lies inside the real Sergipe outline, with the capital east of the inland sector',()=>{
  const ring=map.outline.slice(1,-1).split('L').map(point=>point.split(',').map(Number));
  function inside(point){let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
  assert.equal(Object.keys(map.positions).length,5);assert(ring.length>100);
  for(const [id,point]of Object.entries(map.positions)){assert(inside([point[0]*4,point[1]*3.7]),id+' must be selectable on the state');assert(map.regions[id]);}
  assert(map.positions['se-aracaju'][0]>map.positions['se-agreste'][0]);
  assert(map.sourceURL.startsWith('https://servicodados.ibge.gov.br/'));
});
