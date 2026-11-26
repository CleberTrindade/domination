'use strict';
const BASE=require('./map.json');
const PILOT=require('./pilot-maps.json');
const HISTORICAL_PILOT=require('./pilot-maps-v1.json');
const MW=390,MAPY=70;
const KIND={P:'garagem',G:'garagem',H:'heli',B:'botes',A:'canhao',C:'central'};
const DIRS=[[2,0],[-2,0],[1,-1],[-1,-1],[1,1],[-1,1]];
const definitions=[
  {id:'coast-v1',name:'Arquipélago costeiro',area:'se-litoral-sul',tag:'ILHAS E DESEMBARQUES',description:'Ilhas separadas tornam heliportos e botes essenciais para expandir e atacar por outras direções.',land:(c,r)=>(Math.abs(c)>=4&&Math.abs(r)>=2)||(Math.abs(c)<=2&&Math.abs(r)<=1)||(Math.abs(c)<=1&&Math.abs(r)>=5),garages:[[ -5,-3],[5,-3],[-5,3],[5,3]],guns:[[-2,0],[2,0]]},
  {id:'crossroads-v1',name:'Encruzilhadas do Agreste',area:'se-agreste',tag:'ROTAS ALTERNATIVAS',description:'Corredores externos e uma ligação central permitem dividir o ataque ou contornar posições defendidas.',land:(c,r)=>Math.abs(r)>=4||Math.abs(r)<=1||Math.abs(c)<=1||Math.abs(c)>=5,garages:[[-3,-5],[3,-5],[-3,5],[3,5]],guns:[[-4,0],[4,0]]},
  {id:'passes-v1',name:'Passagens do Sertão',area:'se-alto-sertao',tag:'GARGALO CENTRAL',description:'Uma passagem estreita concentra os tanques. Helicópteros e botes permitem flanquear a linha de defesa.',land:(c,r)=>r!==0||Math.abs(c)<=2,garages:[[-4,-4],[4,-4],[-4,4],[4,4]],guns:[[-2,0],[2,0]]},
  {id:'river-v1',name:'Travessias do São Francisco',area:'se-sao-francisco',tag:'DUAS TRAVESSIAS',description:'Duas ligações atravessam o rio. Dispute as cabeceiras ou use transporte para alcançar as ilhas centrais.',land:(c,r)=>Math.abs(c)>=3||Math.abs(r)===4||(c===0&&[0,-6,6].includes(r)),garages:[[-4,-4],[4,-4],[-4,4],[4,4]],guns:[[0,-4],[0,4]]},
  {id:'citadel-v1',name:'Cerco à Capital',area:'se-aracaju',tag:'ANEL E FORTALEZA',description:'Um anel terrestre contorna uma fortaleza isolada. Domine a periferia e prepare um desembarque na central.',land:(c,r)=>Math.max(Math.abs(c),Math.abs(r))>=5||(Math.abs(c)<=2&&Math.abs(r)<=2),garages:[[-5,-5],[5,-5],[-5,5],[5,5]],guns:[[-2,0],[2,0]]}
];
function makeMap(def){
  const cells=[];
  for(let r=-7;r<=7;r++)for(let c=-7;c<=7;c++)if((c+r)%2===0&&def.land(c,r))cells.push([c,r,195+c*22.5,392+r*39,-1]);
  const byCell=new Map(cells.map((cell,i)=>[cell[0]+','+cell[1],i]));
  const positions=[[[0,0],'C'],...[[[-6,-6],[6,-6],[-6,6],[6,6]],[[0,-6],[0,6]],def.garages,[[-6,-2],[6,-2],[-6,2],[6,2]],def.guns].flatMap((group,index)=>group.map(point=>[point,['P','B','G','H','A'][index]]))];
  const seeds=positions.map(([point,kind])=>{const cell=byCell.get(point.join(','));if(cell===undefined)throw Error('Missing seed '+def.id+' '+point);return [cell,kind];});
  const queue=[];for(let id=0;id<seeds.length;id++){cells[seeds[id][0]][4]=id;queue.push(seeds[id][0]);}
  for(let head=0;head<queue.length;head++){const cell=cells[queue[head]];for(const [dc,dr]of DIRS){const next=byCell.get((cell[0]+dc)+','+(cell[1]+dr));if(next!==undefined&&cells[next][4]===-1){cells[next][4]=cell[4];queue.push(next);}}}
  if(cells.some(cell=>cell[4]===-1))throw Error('Unreachable land without a base: '+def.id);
  return {cells,seeds};
}
const catalog=new Map([['classic',{id:'classic',name:'Campo clássico',description:'Configuração original.',data:BASE}],...definitions.map(def=>[def.id,{id:def.id,name:def.name,area:def.area,tag:def.tag,description:def.description,data:makeMap(def)}])]);
for(const map of [...HISTORICAL_PILOT,...PILOT])catalog.set(map.id,map);
for(const map of catalog.values()){for(const cell of map.data.cells)Object.freeze(cell);for(const seed of map.data.seeds)Object.freeze(seed);Object.freeze(map.data.cells);Object.freeze(map.data.seeds);Object.freeze(map.data);Object.freeze(map);}
function buildGeometry(MAPDATA){
  const cells=MAPDATA.cells.map(([c,r,x,y,t])=>({c,r,x,y:y-MAPY,t}));
  const key=(c,r)=>c+','+r,idx=new Map();cells.forEach((q,i)=>idx.set(key(q.c,q.r),i));
  const DIRS=[[2,0],[-2,0],[1,-1],[-1,-1],[1,1],[-1,1]];
  const nb=MAPDATA.neighbors||cells.map(q=>DIRS.map(([a,b])=>idx.get(key(q.c+a,q.r+b))).filter(v=>v!=null));
  const seeds=MAPDATA.seeds.map(([cell,n])=>({cell,n,kind:KIND[n]}));
  // componentes de terra (ilhas dos botes ficam isoladas)
  const comp=cells.map(()=>-1);let nc=0;
  for(let i=0;i<cells.length;i++){if(comp[i]>=0)continue;const q=[i];comp[i]=nc;while(q.length){const x=q.shift();for(const n of nb[x])if(comp[n]<0){comp[n]=nc;q.push(n)}}nc++}
  // cores alternadas das regiões neutras
  const tcol=seeds.map(()=>-1);
  seeds.forEach((s,t)=>{const used=new Set();cells.forEach((c,i)=>{if(c.t!==t)return;nb[i].forEach(n=>{const o=cells[n].t;if(o!==t&&tcol[o]>=0)used.add(tcol[o])})});let k=0;while(used.has(k))k++;tcol[t]=k});
  const pc=new Map();
  function path(a,b){const k=a+'>'+b;if(pc.has(k))return pc.get(k);
    const prev=new Map([[a,-1]]),q=[a];while(q.length){const x=q.shift();if(x===b)break;for(const n of nb[x])if(!prev.has(n)){prev.set(n,x);q.push(n)}}
    const p=[];if(prev.has(b))for(let x=b;x!==-1;x=prev.get(x))p.push([cells[x].x,cells[x].y]);p.reverse();pc.set(k,p);return p}
  // cantos dos jogadores: azul embaixo-direita, depois cima-esquerda, cima-direita, embaixo-esquerda
  const P=seeds.map((s,i)=>i).filter(i=>seeds[i].n==='P');
  const cx=MW/2,cy=392-MAPY;const corner=(sx,sy)=>P.find(i=>Math.sign(cells[seeds[i].cell].x-cx)===sx&&Math.sign(cells[seeds[i].cell].y-cy)===sy);
  const corners=[corner(1,1),corner(-1,-1),corner(1,-1),corner(-1,1)];
  const weights=seeds.map((_,id)=>cells.filter(c=>c.t===id).length);
  return {cells,nb,seeds,comp,tcol,path,corners,weights,cellKey:idx,center:seeds.findIndex(s=>s.n==='C')};
}
const cache=new Map();
function get(id='classic'){const map=catalog.get(id||'classic');if(!map)throw Error('Unknown battle map: '+id);return map;}
function geometry(id='classic'){const map=get(id);if(!cache.has(map.id)){const hx=buildGeometry(map.data);Object.assign(hx,{width:map.width||390,height:map.height||640,hexAngle:map.hexAngle||0,scroll:!!map.scroll,side:map.side,overflow:map.overflow});
 if(map.scroll){hx.corners=[4,1,2,3];const sides=new Map();for(const [i,c]of hx.cells.entries()){const ring=Array.from({length:6},(_,j)=>{const a=(60*j-90+hx.hexAngle)*Math.PI/180;return [c.x+26*Math.cos(a),c.y+26*Math.sin(a)];});for(let j=0;j<6;j++){const a=ring[j],b=ring[(j+1)%6],key=[a,b].map(p=>p.map(v=>v.toFixed(3)).join(',')).sort().join(':');if(sides.has(key)){const edge=sides.get(key);edge.neighbor=i;}else sides.set(key,{cell:i,neighbor:null,a,b});}}hx.edges=[...sides.values()];}
 cache.set(map.id,hx);}return cache.get(map.id);}
const forArea=area=>PILOT.find(def=>def.area===area)?.id||definitions.find(def=>def.area===area)?.id||'classic';
const list=()=>[...catalog.values()].filter(map=>map.id!=='classic'&&!map.scroll).map(({data,...metadata})=>metadata);
const pilotList=()=>PILOT.map(({data,...meta})=>meta);
const historicalPilotList=()=>HISTORICAL_PILOT.map(({data,...meta})=>meta);
const isWorldMap=id=>!!catalog.get(id)?.area;
module.exports={get,geometry,forArea,list,pilotList,historicalPilotList,isWorldMap};
