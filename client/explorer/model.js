import {territoryCount} from './territories.js';
export {SERGIPE_POINTS} from './territories.js';
export const CONTINENTS=[
 {id:'South America',name:'América do Sul',anchor:[-60,-15],description:'Das ilhas do litoral às grandes capitais. Escolha um país e encontre seu próximo destino.',preferred:'BRA'},
 {id:'North America',name:'América do Norte',anchor:[-100,35],description:'Um continente de grandes distâncias e novas fronteiras. Explore seus países e territórios.',preferred:'USA'},
 {id:'Europe',name:'Europa',anchor:[18,48],description:'Muitas fronteiras, inúmeras possibilidades. Percorra países e descubra cada região.',preferred:'PRT'},
 {id:'Africa',name:'África',anchor:[20,2],description:'Do litoral às regiões do interior. Descubra os países e planeje sua próxima expedição.',preferred:'ZAF'},
 {id:'Asia',name:'Ásia',anchor:[95,32],description:'Um vasto mapa de países e províncias para explorar. Escolha seu próximo horizonte.',preferred:'JPN'},
 {id:'Oceania',name:'Oceania',anchor:[145,-25],description:'Ilhas, arquipélagos e grandes travessias. Explore os países e territórios da Oceania.',preferred:'AUS'}
];
export function wrap(index,length){return length?((index%length)+length)%length:0;}
export function alphabetical(items){return [...items].sort((a,b)=>a.properties.name.localeCompare(b.properties.name,'pt-BR'));}
export function continentCountries(features,continent){return alphabetical(features.filter(f=>f.properties.continent===continent||continent==='Oceania'&&f.properties.continent==='Seven seas (open ocean)'));}
export function initialCountryIndex(countries,continent){const preferred=CONTINENTS.find(c=>c.id===continent)?.preferred;return Math.max(0,countries.findIndex(c=>c.id===preferred));}
export function initialRegionIndex(regions,country){return country==='BRA'?Math.max(0,regions.findIndex(r=>r.id==='BR-SE'||r.properties.name==='Sergipe')):0;}
export function flag(code){return /^[A-Z]{2}$/.test(code)?String.fromCodePoint(...[...code].map(c=>127397+c.charCodeAt(0))):'◈';}
export const SERGIPE_TERRITORIES=Array.from({length:10},(_,i)=>'Área '+String(i+1).padStart(2,'0'));

export function territoryNames(region){return Array.from({length:territoryCount(region)},(_,i)=>'Área '+String(i+1).padStart(2,'0'));}
