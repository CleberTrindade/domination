import fs from 'node:fs';import {geoDistance} from 'd3-geo';
import {SERGIPE_AREAS} from '../client/explorer/sergipe-areas.js';
const ids=['se-litoral-sul','se-agreste','se-alto-sertao','se-sao-francisco','se-aracaju','se-area-06','se-area-07','se-area-08','se-area-09','se-area-10'];
const names=['Litoral Sul','Agreste','Alto Sertão','Vale do São Francisco','Aracaju · Capital',...Array.from({length:5},(_,i)=>'Área '+String(i+6).padStart(2,'0'))];
const targets=[[-37.31,-11.12],[-37.45,-10.63],[-37.85,-9.8],[-36.8,-10.15],[-37.07,-10.94]];
let best=null;
function assign(chosen,remaining,score){if(chosen.length===5){if(!best||score<best.score)best={chosen,remaining,score};return;}for(const i of remaining)assign([...chosen,i],remaining.filter(j=>j!==i),score+geoDistance(targets[chosen.length],SERGIPE_AREAS[i].properties.label)**2);}
assign([],SERGIPE_AREAS.map((_,i)=>i),0);
const order=[...best.chosen,...best.remaining];
const features=order.map((n,i)=>{const f=structuredClone(SERGIPE_AREAS[n]);f.id=ids[i];f.properties={...f.properties,name:names[i],sourceGroup:n+1,liveOrdinal:i+1};return f;});
const outline=JSON.parse(fs.readFileSync('public/explorer/data/BRA.json')).features.find(f=>f.id==='BR-SE');
fs.writeFileSync('public/explorer/data/sergipe-pilot.json',JSON.stringify({type:'FeatureCollection',source:'IBGE; approved Sergipe beta municipal unions',municipalityCount:75,outline,features}));
const {geoMercator,geoPath}=await import('d3-geo');const {normalizeGeometry}=await import('../client/explorer/geometry.js');
normalizeGeometry(outline);features.forEach(normalizeGeometry);
const projection=geoMercator().fitExtent([[58,12],[340,350]],outline),path=geoPath(projection);
const svg={source:'IBGE — 75 municípios em dez grupos',sourceURL:'https://servicodados.ibge.gov.br/api/v3/malhas/estados/28?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio',viewBox:'0 0 400 370',outline:path(outline),paths:Object.fromEntries(features.map(f=>[f.id,path(f)])),positions:Object.fromEntries(features.map(f=>{const p=projection(f.properties.label);return [f.id,[p[0]/4,p[1]/3.7]];})),labelsGeo:Object.fromEntries(features.map(f=>[f.id,f.properties.label])),geometry:outline.geometry,regions:{}};
fs.writeFileSync('public/sergipe-map.js','(function(root){const map='+JSON.stringify(svg)+';if(typeof module===\'object\'&&module.exports)module.exports=map;else root.DOMINATION_SERGIPE_MAP=map;})(typeof window===\'object\'?window:globalThis);');
