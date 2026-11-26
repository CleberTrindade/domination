import {FIELD_MODELS,FIELD_SIZES,FIELD_DIRECTIONS,fieldShapes,fieldMixedShapes,fieldHash} from './field-layouts.mjs';
// Compact, hand-shaped hex islands: the familiar battle-board scale.
export const HEX_RADIUS=30;
const spacing=Math.sqrt(3)*HEX_RADIUS;
function classicWorld(){
 const shapes=[
  {x:250,y:80,team:'red',rows:[[-2,-1,0,1,2],[-3,-2,-1,0,1,2,3],[-3,-2,-1,0,1,2,3],[0,1,2,3],[1,2,3]]},
  {x:260,y:360,team:'neutral',rows:[[0],[-1,0,1],[-2,-1,0,1,2],[-3,-2,-1,0,1,2],[-2,-1,0,1,2],[-1,0,1],[0]]},
  {x:250,y:735,team:'blue',rows:[[2,3],[-2,2,3],[-3,-2,-1,0,1,2,3],[-3,-2,-1,0,1,2],[-2,-1,0,1,2]]}
 ];
 const tiles=[],index=new Map();
 for(const [island,shape] of shapes.entries())for(const [row,cols] of shape.rows.entries())for(const col of cols){
  const tile={island,row,col,x:shape.x+(col+(row%2)*.5)*spacing,y:shape.y+row*HEX_RADIUS*1.5,land:true,team:shape.team,raised:island===0&&row===0&&[-1,0,1].includes(col)};
  if(island===1&&(row>=5||row===0||(row===3&&col===0)))tile.team='blue';
  tiles.push(tile);index.set(island+','+row+','+col,tile);
 }
 const definitions=[
  ['Base azul','blue',1,6,0,0,24],['Oficina azul','blue',1,3,0,1,15],['Posto neutro','neutral',1,2,-2,1,10],['Heliponto leste','neutral',1,4,2,2,14],
  ['Base rival','red',0,1,2,0,38],['Oficina rival','red',0,2,-2,1,15],['Bombardeiro rival','red',0,2,2,3,18],['Heliponto rival','red',0,4,2,2,14],
  ['Bombardeiro azul','blue',1,0,0,3,22],['Posto oeste','neutral',1,3,-2,5,10],['Posto leste','neutral',1,2,2,5,10],['Heliponto oeste','neutral',1,4,-1,2,14],
  ['Base de apoio','blue',2,2,-2,0,27],['Oficina de apoio','blue',2,3,1,1,16],['Bombardeiro sul','blue',2,0,2,3,20]
 ];
 const bases=definitions.map(([name,team,island,row,col,sprite,units],id)=>{const tile=index.get(island+','+row+','+col);if(!tile)throw Error('Missing base tile');tile.raised=false;return {id,name,team,sprite,units,tile,x:tile.x,y:tile.y};});
 const corners=t=>Array.from({length:6},(_,i)=>{const a=(60*i-30)*Math.PI/180;return {x:t.x+Math.cos(a)*HEX_RADIUS,y:t.y+Math.sin(a)*HEX_RADIUS};});
 const edges=new Map();
 for(const t of tiles){const ring=corners(t);for(let i=0;i<6;i++){const a=ring[i],b=ring[(i+1)%6],key=[a,b].map(p=>p.x.toFixed(3)+','+p.y.toFixed(3)).sort().join(':');if(edges.has(key))edges.delete(key);else edges.set(key,{a,b});}}
 // Decorative water routes only. No commands, attack logic, or territory changes.
 const routes=[[0,14],[14,12],[8,6],[12,13]].map(([from,to])=>{const a=bases[from],b=bases[to];return {from,to,points:[{x:a.x,y:a.y+25},{x:(a.x+b.x)/2+34,y:(a.y+b.y)/2},{x:b.x,y:b.y+25}]};});
 return {tiles,bases,routes,edges:[...edges.values()]};
}

function worldFromShapes(shapes,seed){
 const tiles=[];
 for(const [island,shape] of shapes.entries())for(const [row,cols] of shape.rows.entries())for(const col of cols)tiles.push({island,row,col,x:shape.x+(col+(row%2)*.5)*spacing,y:shape.y+row*HEX_RADIUS*1.5,land:true,team:shape.teamFor?shape.teamFor(row,col):shape.teamAt?shape.teamAt(row):shape.team,raised:false});
 const picked=new Set();
 function choose(team,count){
  const pool=tiles.filter(t=>t.team===team),chosen=[];
  if(pool.length<count)throw Error('Insufficient '+team+' base tiles');
  const wanted={x:team==='red'?280:260,y:team==='red'?140:team==='blue'?820:520};
  let next=pool.reduce((best,t)=>Math.hypot(t.x-wanted.x,t.y-wanted.y)<Math.hypot(best.x-wanted.x,best.y-wanted.y)?t:best,pool[0]);
  for(let i=0;i<count;i++){
   chosen.push(next);picked.add(next);
   next=pool.filter(t=>!picked.has(t)).sort((a,b)=>{
    const distance=t=>Math.min(...chosen.map(p=>(p.x-t.x)**2+(p.y-t.y)**2));
    return distance(b)-distance(a)||fieldHash(seed+':'+a.row+','+a.col)-fieldHash(seed+':'+b.row+','+b.col);
   })[0];
  }
  return chosen;
 }
 const blue=choose('blue',5),red=choose('red',4),neutral=choose('neutral',6);
 const order=[blue[0],blue[1],neutral[0],neutral[1],red[0],red[1],red[2],red[3],blue[2],neutral[2],neutral[3],neutral[4],blue[3],blue[4],neutral[5]];
 const sprites=[0,1,1,2,0,1,3,2,3,5,5,2,0,3,9];
 const bases=order.map((tile,id)=>({id,name:id===0?'Base azul':id===4?'Base rival':tile.team==='neutral'?'Posto neutro '+(id+1):tile.team==='blue'?'Apoio azul '+(id+1):'Apoio rival '+(id+1),team:tile.team,sprite:sprites[id],units:id===0?24:id===4?38:10+(fieldHash(seed+':units:'+id)%11),tile,x:tile.x,y:tile.y}));
 const adjacency=new Map(tiles.map(t=>[t,tiles.filter(u=>u!==t&&Math.abs(Math.hypot(t.x-u.x,t.y-u.y)-spacing)<.1)]));
 const blocked=new Set();
 for(const t of tiles.filter(t=>!picked.has(t)&&adjacency.get(t).length>=4).sort((a,b)=>fieldHash(seed+':block:'+a.row+','+a.col)-fieldHash(seed+':block:'+b.row+','+b.col))){
  const neighbors=adjacency.get(t).filter(n=>!blocked.has(n));if(neighbors.length<2)continue;
  const seen=new Set([neighbors[0]]),queue=[neighbors[0]];
  for(let i=0;i<queue.length;i++)for(const n of adjacency.get(queue[i]))if(n!==t&&!blocked.has(n)&&!seen.has(n)){seen.add(n);queue.push(n);}
  if(!neighbors.every(n=>seen.has(n)))continue;
  t.raised=true;blocked.add(t);if(blocked.size===3)break;
 }

 return {tiles,bases};
}
export function createFieldWorld({modelId='ilhas',sizeId='compacto',directionId='vertical',seed=''}={}){
 const model=FIELD_MODELS.find(m=>m.id===modelId)||FIELD_MODELS[0],size=FIELD_SIZES.find(s=>s.id===sizeId)||FIELD_SIZES[0];
 const direction=FIELD_DIRECTIONS.find(d=>d.id===directionId)||FIELD_DIRECTIONS[0],mixed=direction.id==='misto';
 const coreWidth=mixed?960:model.width,coreHeight=mixed?1200:model.height;
 const world=mixed?worldFromShapes(fieldMixedShapes(model.id),seed):model.id==='ilhas'?classicWorld():worldFromShapes(fieldShapes(model.id),seed);
 const {tiles,bases}=world;
 for(const t of tiles){t.y+=size.shift+(mixed?120:0);if(mixed)t.x+=size.shift;}
 if(size.shift){
  const rows=size.id==='amplo'?[[0],[-1,0,1],[-1,0,1]]:[[0],[-1,0]];
  const anchors=[{x:coreWidth*.36+(mixed?size.shift:0),y:size.id==='amplo'?45:40,team:'red'},{x:coreWidth*.64+(mixed?size.shift:0),y:coreHeight+size.shift*2-((rows.length-1)*45+65),team:'blue'}];
  for(const [n,a] of anchors.entries()){
   const island=10+n;
   for(const [row,cols] of rows.entries())for(const col of cols)tiles.push({island,row,col,x:a.x+(col+(row%2)*.5)*spacing,y:a.y+row*45,land:true,team:a.team,raised:false});
   const candidates=tiles.filter(t=>t.island===island),chosen=size.id==='amplo'?[candidates[0],candidates.at(-1)]:[candidates[1]];
   for(const tile of chosen){const id=bases.length;bases.push({id,name:a.team==='blue'?'Posto avançado azul':'Posto avançado rival',team:a.team,sprite:id%2?1:3,units:12,tile,x:tile.x,y:tile.y});}
  }
 }
 const bounds={width:coreWidth+(mixed?size.shift*2:0),height:coreHeight+size.shift*2,overflow:size.overflow,side:mixed?(size.id==='compacto'?1.8:size.id==='medio'?1.95:2.1):size.side};
 const mirrored=!!seed&&!!(fieldHash(seed)&1);
 if(mirrored)for(const t of tiles)t.x=bounds.width-t.x;
 const hexAngle=direction.id==='horizontal'?90:0;
 if(hexAngle){const priorHeight=bounds.height;for(const t of tiles){const priorX=t.x;t.x=priorHeight-t.y;t.y=priorX;}[bounds.width,bounds.height]=[bounds.height,bounds.width];bounds.side=size.id==='compacto'?1.9:size.id==='medio'?2.1:2.3;}
 for(const b of bases){b.x=b.tile.x;b.y=b.tile.y;b.tile.raised=false;}
 const edgeMap=new Map();
 for(const t of tiles){const corners=Array.from({length:6},(_,i)=>{const a=(60*i-30+hexAngle)*Math.PI/180;return {x:t.x+Math.cos(a)*HEX_RADIUS,y:t.y+Math.sin(a)*HEX_RADIUS};});for(let i=0;i<6;i++){const a=corners[i],b=corners[(i+1)%6],key=[a,b].map(p=>p.x.toFixed(3)+','+p.y.toFixed(3)).sort().join(':');if(edgeMap.has(key))edgeMap.delete(key);else edgeMap.set(key,{a,b});}}
 const blue=bases.filter(b=>b.team==='blue'),red=bases.filter(b=>b.team==='red');
 const pairs=[[blue[0],blue[2]],[blue[2],blue.at(-1)],[red[0],red[2]],[blue[1],blue.at(-1)]];
 const routes=pairs.map(([a,b])=>({from:a.id,to:b.id,points:[{x:a.x,y:a.y+25},{x:(a.x+b.x)/2+(mirrored?-22:22),y:(a.y+b.y)/2},{x:b.x,y:b.y+25}]}));
 return {tiles,bases,routes,edges:[...edgeMap.values()],bounds,model,size,direction,hexAngle,mirrored,seed};
}
