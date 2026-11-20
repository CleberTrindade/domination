/* Offline balance study. Does not change the game engine or the published app.
 * node experiments/troop-progression/simulate.js --seeds=50 --start=1001
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const enginePath=require.resolve('./reference-engine');
const original=require(enginePath),STEP=1/30;
const cases=[{name:'Litoral Sul',share:.32,difficulty:1},{name:'Agreste',share:.34,difficulty:2},{name:'Alto Sertão',share:.35,difficulty:3},{name:'São Francisco',share:.37,difficulty:4},{name:'Capital',share:.39,difficulty:5}];
function replaceOnce(source,before,after){assert.equal(source.split(before).length,2,'Engine changed: '+before);return source.replace(before,after);}
function prototypeFactory(){
  let source=fs.readFileSync(enginePath,'utf8');
  source=replaceOnce(source,'function initialSites(share,difficulty=1,centralOwner=0){','function rawInitialSites(share,difficulty=1,centralOwner=0){');
  source=replaceOnce(source,'function createBattle({share=.35,difficulty=1,seed=1,maxSeconds=360,centralOwner=0}={}){',`const setups=new Map();
function initialSites(share,difficulty=1,centralOwner=0,defenderBaseCount=null){
  const key=[share,difficulty,centralOwner,defenderBaseCount].join(':');
  if(!setups.has(key)){
    const setup=rawInitialSites(share,difficulty,centralOwner);
    if(defenderBaseCount!==null){
      if(!Number.isInteger(defenderBaseCount)||defenderBaseCount<1||defenderBaseCount>15)throw Error('Invalid experimental defender base count');
      const home=setup.sites.find(site=>site.owner===2&&site.hq);
      const nearby=setup.sites.filter(site=>site.owner===2&&site.id!==HX.center&&site!==home).sort((a,b)=>Math.hypot(a.x-home.x,a.y-home.y)-Math.hypot(b.x-home.x,b.y-home.y)||a.id-b.id).slice(0,defenderBaseCount-1);
      const keep=new Set([home.id,...nearby.map(site=>site.id),...(centralOwner===2?[HX.center]:[])]);
      for(const site of setup.sites)if(site.owner===2&&!keep.has(site.id)){site.owner=0;site.hq=false;site.troops=Math.round(BASE0*PCT[site.kind]);}
      setup.defenderShare=setup.sites.filter(site=>site.owner===2).reduce((n,site)=>n+weights[site.id],0)/HX.cells.length;
    }
    setups.set(key,setup);
  }
  const setup=setups.get(key);return {...setup,sites:setup.sites.map(site=>({...site}))};
}
function createBattle({share=.35,difficulty=1,seed=1,maxSeconds=360,centralOwner=0,attackerPower=1,defenderPower=1,neutralScaling=false,defenderBaseCount=null}={}){
  const power=owner=>owner===0?(neutralScaling==='attacker'?attackerPower:neutralScaling?defenderPower:1):owner===2?defenderPower:attackerPower;`);
  source=replaceOnce(source,'setup=initialSites(share,difficulty,centralOwner);','setup=initialSites(share,difficulty,centralOwner,defenderBaseCount);');
  // One combat multiplier per troop: shot damage scales only with the shooter.
  // Scaling damage by both shooter AND target would square the requested ratio.
  source=replaceOnce(source,'b.troops-=u.n;','b.troops-=u.n*power(u.owner)/power(b.owner);');
  source=replaceOnce(source,'b.owner=u.owner;b.troops=-b.troops;', 'b.troops=-b.troops*power(b.owner)/power(u.owner);b.owner=u.owner;');
  source=replaceOnce(source,'f[k]+=0.3;tg.n--;sh.kick=0;', 'f[k]+=0.3;tg.n-=power(sh.owner);sh.kick=0;');
  source=replaceOnce(source,'s.cd=FIRE[s.kind];best.n-=1;', 's.cd=FIRE[s.kind];best.n-=power(s.owner);');
  // The CPU estimates required forces using the same combat ratio as the bot.
  source=replaceOnce(source,'const need=t.troops+grow+danger(t,ai.id)+2;', 'const need=(t.troops+grow)*power(t.owner)/power(ai.id)+danger(t,ai.id)+2;');
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:createRequire(enginePath),Map,Set,Math},{filename:'experimental-battle-engine.js'});
  return module.exports;
}
const factory=prototypeFactory();
const geometry=factory.createBattle({centralOwner:2}).checkpoint().sites;
const cells=original.MAPDATA.cells,byCell=new Map(cells.map((c,i)=>[c[0]+','+c[1],i])),components=cells.map(()=>-1);
let component=0;
for(let i=0;i<cells.length;i++)if(components[i]<0){const queue=[i];components[i]=component;for(const j of queue)for(const [dc,dr]of [[2,0],[-2,0],[1,-1],[-1,-1],[1,1],[-1,1]]){const next=byCell.get((cells[j][0]+dc)+','+(cells[j][1]+dr));if(next!=null&&components[next]<0){components[next]=component;queue.push(next);}}component++;}
const distance=(a,b)=>Math.hypot(geometry[a.id].x-geometry[b.id].x,geometry[a.id].y-geometry[b.id].y);
const reachable=(source,target)=>source.id!==target.id&&(geometry[source.id].kind==='heli'||geometry[source.id].kind==='botes'||components[geometry[source.id].cell]===components[geometry[target.id].cell]);
function incoming(snapshot){
  const totals=geometry.map(()=>({1:0,2:0}));
  for(const unit of snapshot.units){const end=unit.P[unit.P.length-1],target=geometry.find(g=>g.x===end[0]&&g.y===end[1]);if(target&&unit.alive)totals[target.id][unit.owner]=(totals[target.id][unit.owner]||0)+unit.n;}
  return totals;
}
function orders(engine,snapshot,policy,config){
  const own=snapshot.sites.filter(s=>s.owner===1),power=owner=>owner===0?(config.neutralScaling==='attacker'?config.attackerPower:config.neutralScaling?config.defenderPower:1):owner===2?config.defenderPower:config.attackerPower;
  if(snapshot.dropM[1]>=1){const site=own.slice().sort((a,b)=>a.troops-b.troops)[0];if(site)engine.command({type:'drop',site:site.id});}
  const traffic=incoming(snapshot);
  if(policy==='coordinated'){
    // Reinforce exposed production bases before selecting a fresh conquest.
    for(const target of own){const deficit=traffic[target.id][2]*power(2)/power(1)-target.troops-traffic[target.id][1];
      if(deficit<8)continue;
      const sources=own.filter(s=>s.troops>=6&&reachable(s,target)).sort((a,b)=>distance(a,target)-distance(b,target));
      const selected=[];let troops=0;for(const source of sources){if(troops>=deficit+5)break;selected.push(source.id);troops+=Math.floor(source.troops);}
      if(troops>=deficit+5){engine.command({type:'send',sources:selected,target:target.id});return;}
    }
  }
  let best=null,bestScore=-Infinity;
  for(const target of snapshot.sites){
    if(target.owner===1)continue;
    const sources=own.filter(s=>s.troops>=(policy==='simple'?16:5)&&reachable(s,target)).sort((a,b)=>distance(a,target)-distance(b,target)).slice(0,policy==='simple'?1:4);
    if(!sources.length)continue;
    const dist=distance(sources[0],target),growth=target.owner===0?0:dist/45*snapshot.par[target.owner].prod;
    let danger=0;
    for(const weapon of snapshot.sites)if(weapon.owner!==1&&['central','canhao'].includes(geometry[weapon.id].kind)){
      if(weapon.id===target.id)danger+=geometry[weapon.id].kind==='central'?7:3;
      else if(distance(weapon,target)<110)danger+=3;
    }
    const need=Math.max(0,(target.troops+growth+traffic[target.id][target.owner||2])*power(target.owner)/power(1)-traffic[target.id][1])+danger+3;
    if(traffic[target.id][1]>need+3)continue;
    const chosen=[];let troops=0;
    for(const source of sources){if(troops>=need*1.15)break;chosen.push(source.id);troops+=Math.floor(source.troops);}
    if(troops<need*1.15)continue;
    const score=policy==='simple'?-dist-need*.15:60-need-dist/10+(target.owner===0?8:6)+(geometry[target.id].kind==='central'?9:0)+(target.hq?4:0)-chosen.length*2;
    if(score>bestScore){bestScore=score;best={type:'send',sources:chosen,target:target.id};}
  }
  if(best)engine.command(best);
}
function validateBaseline(){
  for(const area of cases){const config={...area,seed:37,centralOwner:2},real=original.createBattle(config),copy=factory.createBattle({...config,attackerPower:1,defenderPower:1});
    for(let i=0;i<2100;i++){
      if(i%90===0){const command={type:'send',sources:real.snapshot().sites.filter(s=>s.owner===1&&s.troops>20).map(s=>s.id),target:i%180?0:12};real.command(command);copy.command(command);}
      real.step(STEP);copy.step(STEP);
    }
    // Cross-realm object prototypes differ; serialized snapshots must be exact.
    assert.equal(JSON.stringify(copy.snapshot()),JSON.stringify(real.snapshot()),'Baseline differs: '+area.name);
  }
}
function simulate(area,level,ratio,seed,policy,neutralScaling=false,overrides={}){
  const config={...area,seed,centralOwner:2,attackerPower:1+.1*(level-1),defenderPower:(1+.1*(level-1))*ratio,neutralScaling,...overrides};
  const engine=factory.createBattle(config),interval=policy==='simple'?90:45;
  let snapshot=engine.snapshot(),peak=1;
  for(let frame=0;frame<11000&&!snapshot.over;frame++){
    if(frame%interval===0){snapshot=engine.snapshot();orders(engine,snapshot,policy,config);peak=Math.max(peak,snapshot.sites.filter(s=>s.owner===1).length);}
    engine.step(STEP);
    if(frame%30===0)snapshot=engine.snapshot();
  }
  snapshot=engine.snapshot();
  return {area:area.name,share:area.share,difficulty:area.difficulty,level,ratio,seed,policy,result:snapshot.result,reason:snapshot.reason||'elimination',seconds:+snapshot.time.toFixed(2),attackerBases:snapshot.sites.filter(s=>s.owner===1).length,defenderBases:snapshot.sites.filter(s=>s.owner===2).length,peakBases:peak,win:snapshot.winnerOwner===1?1:0};
}
function main(){
  const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
  const count=Number(args.seeds||50),start=Number(args.start||1001),levels=(args.levels||'1,5,10').split(',').map(Number),ratios=(args.ratios||'0.6,0.65,0.7,1').split(',').map(Number);
  const policies=(args.policies||'simple,coordinated').split(','),neutralScaling=args.neutrals==='attacker'?'attacker':args.neutrals==='scaled',results=[];
  validateBaseline();process.stdout.write('Baseline matches the original engine for all five areas.\n');
  const started=Date.now();
  for(const level of levels)for(const ratio of ratios)for(const policy of policies){
    let wins=0;
    for(const area of cases)for(let seed=start;seed<start+count;seed++){const result=simulate(area,level,ratio,seed,policy,neutralScaling);results.push(result);wins+=result.win;}
    process.stdout.write(JSON.stringify({level,ratio,policy,wins,total:cases.length*count,elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
  }
  const dir=__dirname,name=args.output||'results';
  fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({model:'linear combat power, +10% per player level; original production/caps/troops/AI cadence/central ownership/360s limit; neutral garrisons '+(neutralScaling==='attacker'?'scale with player':neutralScaling?'scale with CPU':'power 1')+'; CPU attack estimates power-aware',seeds:{start,count},results},null,2)+'\n');
  const keys=Object.keys(results[0]);fs.writeFileSync(path.join(dir,name+'.csv'),keys.join(',')+'\n'+results.map(r=>keys.map(k=>r[k]).join(',')).join('\n')+'\n');
}
if(require.main===module)main();
module.exports={factory,simulate,validateBaseline,cases};
