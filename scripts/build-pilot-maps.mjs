import fs from 'node:fs';import {createFieldWorld} from './pilot/field-world.mjs';
const areas=JSON.parse(fs.readFileSync('public/explorer/data/sergipe-pilot.json')).features;
const models=[['ilhas','vertical'],['frentes','horizontal'],['passagem','vertical'],['anel','misto'],['corredor','horizontal'],['dispersas','misto'],['ilhas','horizontal'],['frentes','misto'],['passagem','misto'],['anel','vertical']];
const result=areas.map((area,index)=>{
 const [modelId,directionId]=models[index],world=createFieldWorld({modelId,directionId,sizeId:index>5?'medio':'compacto',seed:'sergipe-pilot-v1-'+area.id}),scale=26/30;
 const W=world.bounds.width*scale,H=world.bounds.height*scale,tiles=world.tiles.map((t,i)=>({x:+(t.x*scale).toFixed(6),y:+(t.y*scale).toFixed(6),c:i,r:0}));
 const neighbors=tiles.map((t,i)=>tiles.flatMap((u,j)=>i!==j&&Math.abs(Math.hypot(t.x-u.x,t.y-u.y)-Math.sqrt(3)*26)<.15?[j]:[]));
 const components=tiles.map(()=>-1);let componentCount=0;
 for(let i=0;i<tiles.length;i++)if(components[i]<0){const q=[i];components[i]=componentCount;for(let k=0;k<q.length;k++)for(const n of neighbors[q[k]])if(components[n]<0){components[n]=componentCount;q.push(n);}componentCount++;}
 const seeds=[],used=new Set();const choose=(x,y,pool=tiles.map((_,i)=>i))=>pool.filter(i=>!used.has(i)).sort((a,b)=>(tiles[a].x-x)**2+(tiles[a].y-y)**2-((tiles[b].x-x)**2+(tiles[b].y-y)**2)||a-b)[0];
 const add=(i,kind)=>{if(i===undefined)throw Error('No seed tile');seeds.push([i,kind]);used.add(i);};
 add(choose(W/2,H/2),'C');for(const [x,y]of [[.15,.15],[.85,.15],[.15,.85],[.85,.85]])add(choose(W*x,H*y,tiles.flatMap((_,i)=>components.filter(c=>c===components[i]).length>=8?[i]:[])),'P');
 const kinds=['B','B','G','G','G','G','H','H','H','H','A','A'];
 for(const kind of kinds){const unseeded=components.findIndex(c=>![...used].some(i=>components[i]===c));
  let i;if(unseeded>=0)i=choose(tiles[unseeded].x,tiles[unseeded].y,tiles.flatMap((_,j)=>components[j]===components[unseeded]?[j]:[]));
  else i=tiles.map((_,j)=>j).filter(j=>!used.has(j)).sort((a,b)=>Math.min(...[...used].map(j=>(tiles[b].x-tiles[j].x)**2+(tiles[b].y-tiles[j].y)**2))-Math.min(...[...used].map(j=>(tiles[a].x-tiles[j].x)**2+(tiles[a].y-tiles[j].y)**2))||a-b)[0];
  add(i,kind);
 }
 // Every tank-producing island needs reachable naval/air transport. Do not
 // strand a headquarters on a one-tile decorative outpost.
 const transport=k=>k==='B'||k==='H';
 for(let component=0;component<componentCount;component++){
  const local=seeds.map((seed,id)=>({seed,id})).filter(({seed})=>components[seed[0]]===component);
  if(local.some(({seed})=>transport(seed[1]))||local.every(({seed})=>seed[1]==='C'))continue;
  const donor=seeds.findIndex(seed=>transport(seed[1])&&seeds.filter(s=>components[s[0]]===components[seed[0]]&&transport(s[1])).length>1);
  if(donor<0)throw Error('Not enough transports');
  const swap=local.find(({seed})=>!['P','C'].includes(seed[1]));
  if(swap)[swap.seed[1],seeds[donor][1]]=[seeds[donor][1],swap.seed[1]];
  else{const free=choose(tiles[local[0].seed[0]].x,tiles[local[0].seed[0]].y,tiles.flatMap((_,i)=>components[i]===component?[i]:[]));used.delete(seeds[donor][0]);seeds[donor][0]=free;used.add(free);}
 }
 const territory=tiles.map(()=>-1),q=[];seeds.forEach(([cell],id)=>{territory[cell]=id;q.push(cell);});for(let k=0;k<q.length;k++)for(const n of neighbors[q[k]])if(territory[n]<0){territory[n]=territory[q[k]];q.push(n);}if(territory.some(id=>id<0))throw Error('Unseeded land');
 return {id:'se-pilot-'+String(index+1).padStart(2,'0')+'-v1',area:area.id,name:world.model.name+' · '+world.direction.name,tag:world.direction.name.toUpperCase(),description:world.model.description+' Campo próprio de '+area.properties.name+'.',width:W,height:H,hexAngle:world.hexAngle,scroll:true,side:directionId==='horizontal'?2.1:directionId==='misto'?1.9:1.4,overflow:directionId==='horizontal'?1.45:1.7,data:{cells:tiles.map((t,i)=>[t.c,t.r,t.x,t.y+70,territory[i]]),seeds,neighbors}};
});
fs.writeFileSync('shared/pilot-maps.json',JSON.stringify(result));console.log('Built',result.length,'versioned live layouts');
