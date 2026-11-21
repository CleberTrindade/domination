/* Deterministic feasibility check against active CPU. Bot results are not
 * predictions of human win rates. Run: node experiments/battle-maps/smoke.js 10 */
'use strict';
const factory=require('../../server/battle-engine'),{powerFor}=require('../../server/progression');
function simulate(id,difficulty,seed,level=1){
  const power=powerFor(level),config={mapId:id,difficulty,seed,centralOwner:2,defenderBaseCount:3,attackerPower:power,defenderPower:power*.8,neutralPower:power};
  const engine=factory.createBattle(config),geometry=factory.maps.geometry(id),sites=engine.checkpoint().sites;
  const distance=(a,b)=>Math.hypot(sites[a.id].x-sites[b.id].x,sites[a.id].y-sites[b.id].y);
  const reachable=(a,b)=>a.id!==b.id&&(['heli','botes'].includes(sites[a.id].kind)||geometry.comp[sites[a.id].cell]===geometry.comp[sites[b.id].cell]);
  for(let frame=0;frame<11000&&!engine.result;frame++){
    if(frame%45===0){
      const state=engine.snapshot(),mine=state.sites.filter(s=>s.owner===1),incoming=sites.map(()=>({1:0,2:0}));
      for(const u of state.units){const end=u.P.at(-1),target=sites.find(s=>s.x===end[0]&&s.y===end[1]);if(target)incoming[target.id][u.owner]+=u.n;}
      if(state.dropM[1]>=1){const site=mine.slice().sort((a,b)=>a.troops-b.troops)[0];if(site)engine.command({type:'drop',site:site.id});}
      let best=null,score=-Infinity;
      for(const target of state.sites){
        if(target.owner===1)continue;
        const sources=mine.filter(s=>s.troops>=8&&reachable(s,target)).sort((a,b)=>distance(a,target)-distance(b,target)).slice(0,4);if(!sources.length)continue;
        const dist=distance(sources[0],target),targetPower=target.owner===2?.8:1;
        const growth=target.owner===0?0:dist/42*state.par[target.owner].prod;
        let danger=0;
        for(const weapon of state.sites)if(weapon.owner!==1&&['central','canhao'].includes(sites[weapon.id].kind)&&distance(weapon,target)<110)danger+=weapon.id===target.id?9:5;
        const need=Math.max(0,(target.troops+growth+incoming[target.id][target.owner||2])*targetPower-incoming[target.id][1])+danger+4;
        if(incoming[target.id][1]>need+3)continue;
        const chosen=[];let available=0;for(const source of sources){if(available>=need*1.2)break;chosen.push(source.id);available+=Math.floor(source.troops);}
        if(available<need*1.2)continue;
        const value=60-need-dist/10+(target.owner===0?8:6)+(sites[target.id].kind==='heli'?6:sites[target.id].kind==='central'?9:0)-chosen.length*2;
        if(value>score){score=value;best={type:'send',sources:chosen,target:target.id};}
      }
      if(best)engine.command(best);
    }
    engine.step(1/30);
  }
  return {won:engine.result==='won',seconds:Math.round(engine.snapshot().time)};
}
if(require.main===module){
  const seeds=Number(process.argv[2]||10),results=[];
  for(const [i,map]of factory.maps.list().entries()){
    let won=0;for(let seed=1;seed<=seeds;seed++)if(simulate(map.id,i+1,1000+seed).won)won++;
    results.push({mapId:map.id,matches:seeds,wins:won,botWinPercent:Math.round(won/seeds*100)});
  }
  console.log(JSON.stringify(results,null,2));
}
module.exports={simulate};
