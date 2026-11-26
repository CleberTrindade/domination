'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),map=require('../public/sergipe-map');
test('all ten campaign markers remain inside the municipal union of Sergipe',async()=>{const {geoContains}=await import('d3-geo');assert.equal(Object.keys(map.positions).length,10);for(const [id,point]of Object.entries(map.labelsGeo)){assert(geoContains(map.geometry,point),id);assert(map.paths[id]);assert(map.positions[id].every(Number.isFinite));}assert(map.sourceURL.startsWith('https://servicodados.ibge.gov.br/'));});
