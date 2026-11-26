// Hand-shaped topology templates, independent of ownership and battle rules.
export const FIELD_MODELS=Object.freeze([
 {id:'ilhas',name:'Três ilhas',description:'Três núcleos separados, com posições variadas.',width:520,height:1040},
 {id:'frentes',name:'Duas frentes',description:'Dois caminhos paralelos e um posto entre eles.',width:640,height:1040},
 {id:'passagem',name:'Passagem estreita',description:'Grandes núcleos ligados por dois gargalos.',width:560,height:1040},
 {id:'anel',name:'Anel',description:'Um lago central abre caminhos pelos dois lados.',width:560,height:1100},
 {id:'corredor',name:'Corredor sinuoso',description:'Um campo contínuo com curvas e trechos estreitos.',width:560,height:1040},
 {id:'dispersas',name:'Ilhas dispersas',description:'Cinco núcleos alternados em posições diferentes.',width:600,height:1100}
]);
export const FIELD_SIZES=Object.freeze([
 {id:'compacto',name:'Compacto',shift:0,overflow:1.45,side:4/3},
 {id:'medio',name:'Médio',shift:90,overflow:1.55,side:1.38},
 {id:'amplo',name:'Amplo',shift:140,overflow:1.7,side:1.45}
]);
export const FIELD_DIRECTIONS=Object.freeze([
 {id:'vertical',name:'Vertical'},
 {id:'horizontal',name:'Horizontal'},
 {id:'misto',name:'Duas direções'}
]);
export function fieldDirectionForSeed(seed){return seed?FIELD_DIRECTIONS[fieldHash(seed+':direction')%FIELD_DIRECTIONS.length].id:'vertical';}
export function fieldSizeForArea(km2){return Number.isFinite(km2)&&km2>50000?'amplo':Number.isFinite(km2)&&km2>10000?'medio':'compacto';}
export function fieldHash(value){let hash=2166136261;for(const char of String(value)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}
export function fieldModelForSeed(seed){return seed?FIELD_MODELS[fieldHash(seed)%FIELD_MODELS.length].id:'ilhas';}
const span=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
export function fieldShapes(modelId){
 const teamAt=row=>row<4?'red':row>11?'blue':'neutral';
 if(modelId==='frentes')return [
  {x:135,y:120,rows:Array.from({length:16},(_,i)=>i===7||i===8?[0]:span(-1,1)),teamAt},
  {x:450,y:120,rows:Array.from({length:16},(_,i)=>i===5||i===10?[0]:span(-1,1)),teamAt},
  {x:295,y:455,team:'neutral',rows:[[0],[-1,0],[0]]}
 ];
 if(modelId==='passagem')return [{x:270,y:105,rows:[...Array.from({length:5},()=>span(-3,3)),[0],[0],...Array.from({length:4},()=>span(-2,2)),[0],[0],...Array.from({length:5},()=>span(-3,3))],teamAt:row=>row<5?'red':row>12?'blue':'neutral'}];
 if(modelId==='anel')return [
  {x:270,y:85,team:'red',rows:[span(-2,2),span(-3,2),span(-2,2)]},
  {x:270,y:360,team:'neutral',rows:[[-1,0,1],span(-2,2),span(-3,3),[-3,-2,2,3],[-3,-2,2,3],[-3,-2,2,3],span(-3,3),span(-2,2),[-1,0,1]]},
  {x:270,y:860,team:'blue',rows:[[-1,0,1],span(-2,2),span(-3,2),span(-2,2)]}
 ];
 if(modelId==='corredor'){
  const centers=[0,0,1,1,2,2,1,1,0,0,-1,-1,-2,-2,-1,-1,0,0,1];
  return [{x:265,y:85,rows:centers.map((c,i)=>[5,9,13].includes(i)?[c]:span(c-1,c+1)),teamAt:row=>row<5?'red':row>13?'blue':'neutral'}];
 }
 if(modelId==='dispersas')return [
  {x:150,y:90,team:'red',rows:[[-1,0,1],[-2,-1,0,1],[-1,0,1],[-1,0]]},
  {x:420,y:270,team:'red',rows:[[0],[-1,0,1],[-1,0,1]]},
  {x:270,y:455,team:'neutral',rows:[[-1,0,1],[-2,-1,0,1,2],[-2,-1,0,1,2],[-1,0,1]]},
  {x:140,y:720,team:'blue',rows:[[-1,0,1],[-1,0,1,2],[-1,0,1],[-1,0]]},
  {x:430,y:890,team:'blue',rows:[[0],[-1,0,1],[-1,0,1]]}
 ];
 return [];
}

// Wider boards have their own geometry rather than stretching the portrait tiles.
export function fieldMixedShapes(modelId){
 const islandRows=[[-1,0,1],span(-2,2),span(-3,2),span(-3,3),span(-2,2),[-1,0,1]];
 const island=(x,y,team)=>({x,y,team,rows:islandRows});
 if(modelId==='ilhas')return [island(680,100,'red'),island(460,390,'neutral'),island(235,680,'blue')];
 if(modelId==='dispersas')return [island(235,90,'blue'),island(740,90,'red'),island(480,380,'neutral'),island(235,680,'blue'),island(740,680,'red')];
 if(modelId==='frentes')return [
  {x:480,y:150,rows:Array.from({length:5},(_,r)=>r===0||r===4?span(-5,5):span(-6,6)),teamFor:(_r,col)=>col<-2?'blue':col>2?'red':'neutral'},
  {x:480,y:620,rows:Array.from({length:5},(_,r)=>r===0||r===4?span(-5,5):span(-6,6)),teamFor:(_r,col)=>col<-2?'blue':col>2?'red':'neutral'},
  {x:480,y:435,team:'neutral',rows:[[-1,0,1],[-1,0,1],[-1,0,1]]}
 ];
 const teamFor=(row,col)=>row<5?'red':row>13?'blue':col>3?'red':col<-3?'blue':'neutral';
 if(modelId==='passagem')return [{x:480,y:75,teamFor,rows:Array.from({length:19},(_,r)=>r<5||r>13?span(-2,2):[5,6,12,13].includes(r)?[0]:r===7||r===11?span(-5,5):span(-6,6))}];
 if(modelId==='anel')return [{x:480,y:75,teamFor:(_r,col)=>col<-2?'blue':col>2?'red':'neutral',rows:Array.from({length:19},(_,row)=>{
  const r=row-9;return span(-10,10).filter(col=>{const q=col-Math.floor(r/2),distance=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));return distance<=8&&distance>=4;});
 })}];
 const centers=[-4,-4,-3,-2,-1,0,1,2,3,4,4,3,2,1,0,-1,-2,-3,-4];
 return [{x:480,y:75,rows:centers.map((c,r)=>[5,13].includes(r)?[c]:span(c-1,c+1)),teamAt:row=>row<5?'red':row>13?'blue':'neutral'}];
}
