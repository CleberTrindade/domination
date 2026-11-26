// Opposing starts share terrain, structure types and travel distances by a half turn.
const R=26,spacing=Math.sqrt(3)*R;
export function balancedField(world,{axis='y',center:preferredCenter}={}){
 const raw=world.tiles.map(t=>({x:t.x*26/30,y:t.y*26/30})),wanted={x:world.bounds.width*26/60,y:world.bounds.height*26/60};
 const center=preferredCenter?{x:preferredCenter.x*26/30,y:preferredCenter.y*26/30}:raw.reduce((a,b)=>Math.hypot(b.x-wanted.x,b.y-wanted.y)<Math.hypot(a.x-wanted.x,a.y-wanted.y)?b:a);
 const side=p=>{const along=p[axis]-center[axis],across=p[axis==='x'?'y':'x']-center[axis==='x'?'y':'x'];return along>1e-5||Math.abs(along)<=1e-5&&across>=-1e-5;};
 const key=p=>p.x.toFixed(5)+','+p.y.toFixed(5),tiles=[],index=new Map();
 const insert=p=>{const k=key(p);if(!index.has(k)){index.set(k,tiles.length);tiles.push(p);}};
 for(const p of raw)if(side(p)){insert(p);insert({x:2*center.x-p.x,y:2*center.y-p.y});}
 insert(center); // A ring keeps its lake, with the central weapon on a small island.
 const mirror=tiles.map(p=>index.get(key({x:2*center.x-p.x,y:2*center.y-p.y}))),central=index.get(key(center));
 const neighbors=tiles.map((p,i)=>tiles.flatMap((q,j)=>i!==j&&Math.abs(Math.hypot(p.x-q.x,p.y-q.y)-spacing)<.15?[j]:[]));
 const comp=tiles.map(()=>-1),sizes=[];
 for(let i=0;i<tiles.length;i++)if(comp[i]<0){const id=sizes.length,q=[i];comp[i]=id;for(let k=0;k<q.length;k++)for(const n of neighbors[q[k]])if(comp[n]<0){comp[n]=id;q.push(n);}sizes.push(q.length);}
 const positive=tiles.flatMap((p,i)=>side(p)&&mirror[i]!==i?[i]:[]),used=new Set([central]),seeds=Array(17),seedMirror=[0,4,3,2,1,6,5,8,7,10,9,12,11,14,13,16,15];seeds[0]=[central,'C'];
 const dist=(a,b)=>Math.hypot(tiles[a].x-tiles[b].x,tiles[a].y-tiles[b].y);
 function available(pool=positive){return pool.filter(i=>!used.has(i)&&!used.has(mirror[i]));}
 function pair(id,kind,cell){if(cell===undefined)throw Error('No balanced '+kind+' position');seeds[id]=[cell,kind];seeds[seedMirror[id]]=[mirror[cell],kind];used.add(cell);used.add(mirror[cell]);return cell;}
 function nearest(pool,score){return available(pool).sort((a,b)=>score(a)-score(b)||a-b)[0];}
 const along=i=>tiles[i][axis]-center[axis],across=i=>Math.abs(tiles[i][axis==='x'?'y':'x']-center[axis==='x'?'y':'x']);
 const homes=positive.filter(i=>sizes[comp[i]]>=12&&neighbors[i].length>=3),extent=Math.max(...homes.map(along));
 const home=pair(4,'P',nearest(homes,i=>Math.abs(along(i)-extent*.78)+across(i)*.3));
 const local=positive.filter(i=>comp[i]===comp[home]);
 const nearby=(origin,pool)=>nearest(pool,i=>Math.abs(dist(i,origin)-spacing*2.1)+Math.max(0,spacing*1.5-Math.min(...[...used].map(j=>dist(i,j))))*3);
 const boat=pair(5,'B',nearby(home,local));
 // Two vertex-disjoint early routes: neither support is behind a single bottleneck.
 function independent(a,b,c){
  const n=tiles.length*2+1,sink=n-1,edges=Array.from({length:n},()=>new Map()),put=(x,y,v)=>{edges[x].set(y,v);if(!edges[y].has(x))edges[y].set(x,0);};
  for(let i=0;i<tiles.length;i++){put(i*2,i*2+1,i===a?2:1);for(const j of neighbors[i])put(i*2+1,j*2,2);}
  put(b*2+1,sink,1);put(c*2+1,sink,1);let flow=0;
  while(flow<2){const prev=new Map([[a*2,-1]]),q=[a*2];for(let k=0;k<q.length&&!prev.has(sink);k++)for(const [j,v]of edges[q[k]])if(v>0&&!prev.has(j)){prev.set(j,q[k]);q.push(j);}if(!prev.has(sink))break;for(let i=sink;prev.get(i)!==-1;i=prev.get(i)){const p=prev.get(i);edges[p].set(i,edges[p].get(i)-1);edges[i].set(p,edges[i].get(p)+1);}flow++;}
  return flow===2;
 }
 const air=pair(11,'H',nearby(home,available(local).filter(i=>independent(home,boat,i))));
 const garage=pair(7,'G',nearby(home,local));
 const spread=pool=>nearest(pool,i=>-Math.min(...[...used].map(j=>dist(i,j))));
 const unseeded=()=>positive.filter(i=>![...used].some(j=>comp[j]===comp[i]));
 const otherHomes=positive.filter(i=>sizes[comp[i]]>=8&&neighbors[i].length>=2);
 const secondPool=unseeded().filter(i=>otherHomes.includes(i));
 const second=pair(2,'P',spread(secondPool.length?secondPool:otherHomes.filter(i=>comp[i]!==comp[home]).length?otherHomes.filter(i=>comp[i]!==comp[home]):otherHomes));
 pair(13,'H',nearby(second,positive.filter(i=>comp[i]===comp[second])));
 for(const [id,kind]of [[9,'G'],[15,'A']]){const pool=unseeded();pair(id,kind,spread(pool.length?pool:positive));}
 if(comp.some(c=>![...used].some(i=>comp[i]===c)))throw Error('Unseeded balanced island');
 // Resolve equal-distance Voronoi ties as mirrored pairs as well.
 const distances=seeds.map(([start])=>{const d=tiles.map(()=>Infinity),q=[start];d[start]=0;for(let k=0;k<q.length;k++)for(const j of neighbors[q[k]])if(!Number.isFinite(d[j])){d[j]=d[q[k]]+1;q.push(j);}return d;});
 const territory=tiles.map(()=>-1);
 for(let i=0;i<tiles.length;i++)if(side(tiles[i])){let best=0;for(let id=1;id<seeds.length;id++)if(distances[id][i]<distances[best][i])best=id;territory[i]=best;territory[mirror[i]]=seedMirror[best];}
 if(territory.some(id=>id<0))throw Error('Unassigned balanced territory');
 const minX=Math.min(...tiles.map(p=>p.x)),minY=Math.min(...tiles.map(p=>p.y)),maxX=Math.max(...tiles.map(p=>p.x)),maxY=Math.max(...tiles.map(p=>p.y));
 const width=maxX-minX+R*3,height=maxY-minY+R*3;
 return {width,height,data:{cells:tiles.map((p,i)=>[i,0,+(p.x-minX+R*1.5).toFixed(6),+(p.y-minY+R*1.5+70).toFixed(6),territory[i]]),seeds,neighbors,mirror:{cells:mirror,seeds:seedMirror},initialDefense:[1,8,12]},audit:{home,boat,air,garage,components:sizes.length,homeBases:seeds.filter(([i])=>comp[i]===comp[home]).length}};
}
