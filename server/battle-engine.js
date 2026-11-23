// Shared deterministic combat, with versioned world maps and classic compatibility.
'use strict';
const maps=require('../shared/battle-maps');
const troopRules=require('../shared/troop-rules');
const MAPDATA=maps.get('classic').data;
const HR=26;
const CAPITAL_DEFENSE_VERSION='capital-v5';
const PCT={garagem:.40,heli:.55,botes:.45,canhao:.55,central:.55};
const BASE0=25,RANGE=Object.fromEntries(Object.entries(troopRules.weaponRange(troopRules.COMBAT_VERSION)).map(([kind,range])=>[kind,HR*range])),FIRE={central:.42,canhao:.95};
const SPEED=Object.fromEntries(Object.entries(troopRules.DEFINITIONS).filter(([,t])=>t.speed).map(([kind,t])=>[kind,t.speed]));
const HX=maps.geometry('classic'),weights=HX.weights;
function seeded(seed){const random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};random.state=()=>seed;random.restore=value=>{seed=value|0;};return random;}
const initialCache=new Map();
function initialSites(share,difficulty=1,centralOwner=0,defenderBaseCount=null,mapId=null){
  const HX=maps.geometry(mapId),weights=HX.weights;
  const cacheKey=[mapId,share,difficulty,centralOwner,defenderBaseCount].join(':');
  if(initialCache.has(cacheKey)){const cached=initialCache.get(cacheKey);return {...cached,sites:cached.sites.map(site=>({...site}))};}
  const sites=HX.seeds.map((s,id)=>{const c=HX.cells[s.cell];return{id,x:c.x,y:c.y,cell:s.cell,kind:s.kind,n:s.n,owner:0,troops:Math.round(BASE0*PCT[s.kind]),hq:false,cd:0}});
  const attacker=HX.corners[0],defender=HX.corners[1],target=share*HX.cells.length;
  const candidates=sites.filter(s=>s.id!==attacker&&s.id!==defender&&s.id!==HX.center);
  if(mapId&&mapId!=='classic'&&defenderBaseCount!==null){
    if(!Number.isInteger(defenderBaseCount)||defenderBaseCount<1||defenderBaseCount>15)throw Error('Invalid defender base count');
    const home=sites[defender],nearby=sites.filter(s=>s.id!==attacker&&s.id!==defender&&s.id!==HX.center).sort((a,b)=>Math.hypot(a.x-home.x,a.y-home.y)-Math.hypot(b.x-home.x,b.y-home.y)||a.id-b.id).slice(0,defenderBaseCount-1);
    for(const site of [home,...nearby,...(centralOwner===2?[sites[HX.center]]:[])]){site.owner=2;site.troops=10+difficulty;}
    home.hq=true;home.troops=22+difficulty;sites[attacker].owner=1;sites[attacker].hq=true;sites[attacker].troops=38;
    const setup={sites,defenderShare:sites.filter(s=>s.owner===2).reduce((n,s)=>n+weights[s.id],0)/HX.cells.length};
    if(initialCache.size>=128)initialCache.delete(initialCache.keys().next().value);
    initialCache.set(cacheKey,{...setup,sites:sites.map(s=>({...s}))});return setup;
  }
  let best=null,bestScore=Infinity;
  for(let bits=0;bits<2**candidates.length;bits++){
    const ids=centralOwner===2?[defender,HX.center]:[defender];for(let j=0;j<candidates.length;j++)if(bits&(1<<j))ids.push(candidates[j].id);
    const size=ids.reduce((n,id)=>n+weights[id],0);
    const distance=ids.reduce((n,id)=>n+Math.hypot(sites[id].x-sites[defender].x,sites[id].y-sites[defender].y)*weights[id],0);
    const score=Math.abs(size-target)*100000+distance;
    if(score<bestScore){bestScore=score;best=ids;}
  }
  for(const id of best){sites[id].owner=2;sites[id].troops=10+difficulty;}
  sites[defender].hq=true;sites[defender].troops=22+difficulty;
  sites[attacker].owner=1;sites[attacker].hq=true;sites[attacker].troops=38;
  if(defenderBaseCount!==null){
    if(!Number.isInteger(defenderBaseCount)||defenderBaseCount<1||defenderBaseCount>15)throw Error('Invalid defender base count');
    const home=sites[defender],nearby=sites.filter(site=>site.owner===2&&site.id!==HX.center&&site!==home).sort((a,b)=>Math.hypot(a.x-home.x,a.y-home.y)-Math.hypot(b.x-home.x,b.y-home.y)||a.id-b.id).slice(0,defenderBaseCount-1);
    const keep=new Set([home.id,...nearby.map(site=>site.id),...(centralOwner===2?[HX.center]:[])]);
    for(const site of sites)if(site.owner===2&&!keep.has(site.id)){site.owner=0;site.hq=false;site.troops=Math.round(BASE0*PCT[site.kind]);}
  }
  const setup={sites,defenderShare:sites.filter(site=>site.owner===2).reduce((n,site)=>n+weights[site.id],0)/HX.cells.length};
  if(initialCache.size>=128)initialCache.delete(initialCache.keys().next().value);
  initialCache.set(cacheKey,{...setup,sites:sites.map(site=>({...site}))});return setup;
}
function createBattle({share=.35,difficulty=1,seed=1,maxSeconds=360,centralOwner=0,defenderBaseCount=null,
  attackerPower=1,defenderPower=1,neutralPower=1,attackerLevel=1,defenderLevel=1,balanceVersion=null,attackerTroops=null,defenderTroops=null,neutralTroops=null,mapId=null,attackerLoadout=null,defenderLoadout=null,combatVersion=null,defenseVersion=null}={}){
  const HX=maps.geometry(mapId),expanded=balanceVersion==='troops-v3';
  const RANGE=Object.fromEntries(Object.entries(troopRules.weaponRange(combatVersion)).map(([kind,range])=>[kind,HR*range]));
  const definition=k=>troopRules.DEFINITIONS[k]||troopRules.DEFINITIONS.tanque;
  const selected=value=>{if(!expanded)return null;if(value===null||value===undefined)return ['tanque'];if(!Array.isArray(value)||value.length<1||value.length>3||new Set(value).size!==value.length||value.some(k=>!troopRules.GROUND.includes(k)))throw Error('Invalid ground loadout');return value.slice();};
  attackerLoadout=selected(attackerLoadout);defenderLoadout=selected(defenderLoadout);
  if([attackerPower,defenderPower,neutralPower].some(power=>!Number.isFinite(power)||power<=0||power>10))throw Error('Invalid army power');
  if(!Number.isInteger(attackerLevel)||attackerLevel<1||attackerLevel>10||defenderLevel!==null&&(!Number.isInteger(defenderLevel)||defenderLevel<1||defenderLevel>10))throw Error('Invalid army level');
  const cloneTroops=troops=>{if(!troops)return null;const result={};for(const kind of expanded?troopRules.KINDS:troopRules.CORE){const t=troops[kind]||(!troopRules.CORE.includes(kind)?{level:1,power:troops.tanque.power}:null);if(!t||!Number.isFinite(t.power)||t.power<=0||t.power>10||t.level!==null&&(!Number.isInteger(t.level)||t.level<1||t.level>10))throw Error('Invalid troop profile');result[kind]={level:t.level,power:t.power};}return result;};
  attackerTroops=cloneTroops(attackerTroops);defenderTroops=cloneTroops(defenderTroops);neutralTroops=cloneTroops(neutralTroops);
  let defenderControlled=false;
  const random=seeded(seed),setup=initialSites(share,difficulty,centralOwner,defenderBaseCount,mapId);
  const aip={prod:.65+difficulty*.045,cap:50,int:Math.max(1.8,3.6-difficulty*.25),aggr:.55};
  if([CAPITAL_DEFENSE_VERSION,'capital-v4','capital-v3','capital-v2'].includes(defenseVersion)&&mapId==='citadel-v1'&&difficulty===5){
    aip.prod=.85;aip.int=({'capital-v2':2.45,'capital-v3':2.5,'capital-v4':2.47})[defenseVersion]??2.45;
    // 26 in HQ, 14 in the central weapon and 15 in each support base = 70.
    for(const site of setup.sites)if(site.owner===2){if(site.hq)site.troops=26;else if(site.kind==='central')site.troops=14;}
  }
  const game={objectives:{},participation:{1:0,2:0},sites:setup.sites,units:[],fights:[],fx:[],time:0,uid:0,me:1,mode:'solo',over:false,result:null,winnerOwner:null,joinedOwners:[],forfeited:[],cd:3,
    stats:{cap:0,kill:0},dropM:{1:.35,2:.35},par:{1:{prod:1.2,cap:60},2:aip},aip,ais:[{id:2,timer:7,dead:false}],
    armies:{1:{level:attackerLevel,power:attackerPower,...(attackerTroops?{troops:attackerTroops}:{}),...(expanded?{loadout:attackerLoadout}:{})},2:{level:defenderLevel,power:defenderPower,...(defenderTroops?{troops:defenderTroops}:{}),...(expanded?{loadout:defenderLoadout}:{})}}};
  const power=(owner,kind)=>owner===0?(neutralTroops?.[kind]?.power??neutralPower):(game.armies[owner]?.troops?.[kind]?.power??game.armies[owner]?.power??1);
  const toast=()=>{};
  function endGameOwner(owner){if(!game.over){game.over=true;game.winnerOwner=owner;game.result=owner===2?'lost':'won';}}
const unitKind=(s,target)=>s.kind==='heli'?'heli':s.kind==='botes'||target&&troopRules.navalSortie(s.kind,HX.comp[s.cell]===HX.comp[target.cell],combatVersion)?'desliz':expanded&&troopRules.GROUND.includes(s.kind)?s.kind:'tanque';
const land=k=>!['heli','desliz'].includes(k);
function specialize(site){if(!expanded||!['P','G'].includes(site.n))return;const choices=game.armies[site.owner]?.loadout||['tanque'],kind=choices[site.hq?0:site.id%choices.length];site.kind=site.owner&&kind!=='tanque'?kind:'garagem';}
if(expanded)for(const site of game.sites)specialize(site);
const attack=(owner,kind)=>power(owner,kind)*(expanded?definition(kind).attack:1);
const armor=kind=>expanded?definition(kind).armor:1;
function hitBase(site,amount){const absorbed=Math.min(site.fortification||0,amount);if(expanded)site.fortification=Math.max(0,(site.fortification||0)-absorbed);site.troops-=amount-absorbed;}
const canReach=(a,b)=>!!a&&!!b&&a!==b&&(!land(unitKind(a,b))||HX.comp[a.cell]===HX.comp[b.cell]);
function mkPath(a,b,k){
  const P=land(k)?HX.path(a.cell,b.cell):[[a.x,a.y],[b.x,b.y]];
  const cum=[0];for(let i=1;i<P.length;i++){const dx=P[i][0]-P[i-1][0],dy=P[i][1]-P[i-1][1];cum.push(cum[i-1]+Math.sqrt(dx*dx+dy*dy))}
  return {P,cum,L:cum[cum.length-1]};
}
function send(from,to){
  const g=game;if(!canReach(from,to))return;
  const n=Math.floor(from.troops);if(n<1)return;
  const k=unitKind(from,to),path=mkPath(from,to,k);if(path.L<=0)return;
  from.troops-=n;
  g.units.push({id:++g.uid,k,owner:from.owner,n,P:path.P,cum:path.cum,L:path.L,d:0,si:0,to,x:from.x,y:from.y,alive:true});
}
function upos(u){
  while(u.si<u.P.length-2&&u.d>u.cum[u.si+1])u.si++;
  const i=u.si,a=u.P[i],b=u.P[i+1]||a,seg=(u.cum[i+1]-u.cum[i])||1,f=Math.max(0,Math.min(1,(u.d-u.cum[i])/seg));
  u.x=a[0]+(b[0]-a[0])*f;u.y=a[1]+(b[1]-a[1])*f;
}
function arrive(u){
  const b=u.to,g=game;
  if(b.owner===u.owner){b.troops+=u.n;if(expanded&&u.k==='engenheiro')b.fortification=Math.min(20,(b.fortification||0)+u.n*.35);return}
  if(u.owner===g.me&&b.owner!==0)g.stats.kill+=Math.min(u.n,Math.floor(b.troops));
  const attackPower=attack(u.owner,u.k)*(expanded?troopRules.matchup(u.k,unitKind(b)):1),guardPower=power(b.owner,unitKind(b))*armor(unitKind(b));
  hitBase(b,u.n*attackPower/guardPower);
  if(b.troops<0){
    if(expanded){const progress=g.objectives[u.owner]||(g.objectives[u.owner]={orders:0,captured:[]});if(b.owner!==0&&(u.owner!==2||defenderControlled)&&!progress.captured.includes(b.id))progress.captured.push(b.id);}
    b.troops=-b.troops*guardPower/attackPower;b.owner=u.owner;b.hq=false;b.fortification=0;specialize(b);g.dirty=true;
    g.fx.push({type:'ring',x:b.x,y:b.y,t:0,c:'#ffffff'});g.fx.push({type:'cap',x:b.x,y:b.y,t:0,o:u.owner});
    if(u.owner===g.me)g.stats.cap++;
  }else g.fx.push({type:'hit',x:b.x,y:b.y,t:0});
}
function danger(t,o){
  const g=game,C=g.sites[HX.center];let d=0;
  if(t.kind==='central')d+=7;else if(t.kind==='canhao')d+=3;
  if(t!==C&&C.owner!==o){const dx=t.x-C.x,dy=t.y-C.y;if(dx*dx+dy*dy<(RANGE.central+12)**2)d+=4}
  return d;
}
function aiThink(ai){
  const g=game,mine=g.sites.filter(s=>s.owner===ai.id);if(!mine.length)return;
  let best=null,bs=-1e9;
  for(const t of g.sites){
    if(t.owner===ai.id)continue;
    const srcs=mine.filter(s=>s.troops>=4&&canReach(s,t)).sort((a,b)=>Math.hypot(a.x-t.x,a.y-t.y)-Math.hypot(b.x-t.x,b.y-t.y)).slice(0,3);
    if(!srcs.length)continue;
    const dist=Math.hypot(srcs[0].x-t.x,srcs[0].y-t.y);
    const grow=t.owner===0?0:(dist/45)*g.par[t.owner].prod;
    const sourcePower=Math.max(...srcs.map(s=>attack(ai.id,unitKind(s,t))));
    const need=(t.troops+grow+(t.fortification||0))*power(t.owner,unitKind(t))*armor(unitKind(t))/sourcePower+danger(t,ai.id)+2;
    let sum=0,use=[];for(const s of srcs){if(sum>=need*1.15)break;use.push(s);sum+=Math.floor(s.troops)*(attack(ai.id,unitKind(s,t))/sourcePower)}
    if(sum<need*1.15)continue;
    const sc=40-need-dist/12+(t.owner===0?4:0)+(t.owner===1?g.aip.aggr*10:0)+(t.kind==='central'?5:0)+(t.hq?3:0)+random()*4-use.length*2;
    if(sc>bs){bs=sc;best=[use,t]}
  }
  if(best)best[0].forEach(s=>send(s,best[1]));
}
const alive=o=>game.sites.some(s=>s.owner===o)||game.units.some(u=>u.owner===o);
function segX(ax,ay,bx,by,cx,cy,dx,dy){ // os deslocamentos deste passo se cruzam?
  const d1=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax),d2=(bx-ax)*(dy-ay)-(by-ay)*(dx-ax),d3=(dx-cx)*(ay-cy)-(dy-cy)*(ax-cx),d4=(dx-cx)*(by-cy)-(dy-cy)*(bx-cx);
  return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
}
/* passo determinístico da simulação (mesmo resultado em todos os aparelhos da partida online) */
function simStep(dt){
  const g=game;g.time+=dt;
  if(expanded)for(const owner of Object.keys(g.par).map(Number))if(!g.forfeited.includes(owner)&&alive(owner)&&(owner!==2||defenderControlled))g.participation[owner]=(g.participation[owner]||0)+dt;
  for(const s of g.sites){
    if(s.owner===0)continue;
    const P=g.par[s.owner];
    if(expanded)s.fortification=Math.max(0,(s.fortification||0)-dt*.3);
    if(s.troops<P.cap)s.troops=Math.min(P.cap,s.troops+P.prod*dt*(s.hq?1.25:1)*(expanded?(definition(unitKind(s)).production||1):1));
    else s.troops=Math.max(P.cap,s.troops-dt*1.5);
  }
  for(const u of g.units){
    u.px=u.x;u.py=u.y;
    if(u.fight)continue;               // em batalha: fica parado
    if(expanded&&u.k==='artilharia'&&u.to.owner!==u.owner&&Math.hypot(u.x-u.to.x,u.y-u.to.y)<=HR*3&&u.to.troops+(u.to.fortification||0)>2){
      u.siegeTimer=(u.siegeTimer||0)-dt;
      if(u.siegeTimer<=0){u.siegeTimer=1.3;const target=u.to,guard=power(target.owner,unitKind(target))*armor(unitKind(target));hitBase(target,Math.sqrt(u.n)*.9*power(u.owner,u.k)/guard);target.troops=Math.max(1,target.troops);g.fx.push({type:'siege',from:u,s:target,x:target.x,y:target.y,t:0});}continue;
    }
    u.d+=SPEED[u.k]*dt;
    if(u.d>=u.L){u.alive=false;arrive(u);continue}
    upos(u);
  }
  // tropas inimigas que se encontram param, viram uma para a outra e trocam tiros (-1 por tiro) até uma acabar
  const us=g.units;
  for(let i=0;i<us.length;i++){
    const u=us[i];if(!u.alive||u.fight)continue;
    for(let j=i+1;j<us.length;j++){
      const v=us[j];if(!v.alive||v.fight||v.owner===u.owner)continue;
      const dx=u.x-v.x,dy=u.y-v.y;
      if(dx*dx+dy*dy<3364||segX(u.px,u.py,u.x,u.y,v.px,v.py,v.x,v.y)){
        const f={a:u,b:v,ta:0.25,tb:0.4,x:(u.x+v.x)/2,y:(u.y+v.y)/2,age:0};u.fight=f;v.fight=f;g.fights.push(f);
        g.fx.push({type:'clash',x:f.x,y:f.y,t:0});break}
    }
  }
  for(const f of g.fights){
    f.age+=dt;f.ta-=dt;f.tb-=dt;
    for(const [sh,tg,k] of [[f.a,f.b,'ta'],[f.b,f.a,'tb']]){
      if(f[k]>0||sh.n<=0||tg.n<=0)continue;
      f[k]+=expanded?definition(sh.k).interval:.3;tg.n-=expanded?attack(sh.owner,sh.k)*troopRules.matchup(sh.k,tg.k)/armor(tg.k):power(sh.owner,sh.k);sh.kick=0;
      if(sh.owner===g.me)g.stats.kill++;
      g.fx.push({type:'ushot',from:sh,to:tg,t:0});
    }
    if(f.a.n<=0||f.b.n<=0||!f.a.alive||!f.b.alive){f.done=true;
      for(const u of [f.a,f.b]){u.fight=null;if(u.n<=0&&u.alive){u.alive=false;g.fx.push({type:'boom',x:u.x,y:u.y,t:0})}}}
  }
  g.fights=g.fights.filter(f=>!f.done);
  // bombardeiros: atiram no inimigo mais próximo dentro do alcance (-1 tropa por tiro)
  for(const s of g.sites){
    if(s.kind!=='central'&&s.kind!=='canhao')continue;
    if(s.cd>0){s.cd-=dt;continue}
    const R2=RANGE[s.kind]**2;let best=null,bd=R2;
    for(const u of us){if(!u.alive||u.owner===s.owner)continue;const dx=u.x-s.x,dy=u.y-s.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=u}}
    if(!best)continue;
    s.cd=FIRE[s.kind];best.n-=power(s.owner,s.kind)/armor(best.k);s.tx=best.x;s.ty=best.y;s.kick=0;
    if(s.owner===g.me&&best.owner!==g.me)g.stats.kill++;
    g.fx.push({type:'shot',s,x:best.x,y:best.y,t:0,heli:best.k==='heli'});
    if(best.n<=0){best.alive=false;g.fx.push({type:'boom',x:best.x,y:best.y,t:0});if(best.fight){const o=best.fight.a===best?best.fight.b:best.fight.a;o.fight=null;best.fight.done=true}}
  }
  g.units=us.filter(u=>u.alive);g.fights=g.fights.filter(f=>!f.done);
  for(const k in g.dropM)g.dropM[k]=Math.min(1,g.dropM[k]+dt/18);
  if(!defenderControlled)for(const ai of g.ais){ai.timer-=dt;if(ai.timer<=0){ai.timer=g.aip.int*(0.7+random()*0.6);aiThink(ai)}}
  const remaining=Object.keys(g.par).map(Number).filter(owner=>!g.forfeited.includes(owner)&&alive(owner));
  if(remaining.length===1)endGameOwner(remaining[0]);
}

  function command(action,owner=1){
    if(game.over||game.cd>0||!action||typeof action!=='object')return false;
    if(!game.par[owner]||game.forfeited.includes(owner)||(owner===2&&!defenderControlled))return false;
    if(action.type==='send'){
      if(!Array.isArray(action.sources)||action.sources.length>17||!Number.isInteger(action.target))return false;
      const target=game.sites[action.target];if(!target)return false;
      let sent=false;for(const id of new Set(action.sources)){
        if(!Number.isInteger(id))continue;const source=game.sites[id];
        if(source&&source.owner===owner&&canReach(source,target)&&source.troops>=1){send(source,target);sent=true;}
      }if(expanded&&sent)(game.objectives[owner]||(game.objectives[owner]={orders:0,captured:[]})).orders++;return sent;
    }
    if(action.type==='drop'&&Number.isInteger(action.site)){
      const s=game.sites[action.site];if(!s||s.owner!==owner||game.dropM[owner]<1)return false;
      if(expanded)(game.objectives[owner]||(game.objectives[owner]={orders:0,captured:[]})).orders++;
      s.troops+=12;game.dropM[owner]=0;game.fx.push({type:'txt',x:s.x,y:s.y-22,t:0,text:'+12'});return true;
    }
    return false;
  }
  function step(dt){
    if(game.over)return;
    for(const f of game.fx)f.t+=dt;
    game.fx=game.fx.filter(f=>f.t<1.2).slice(-60);
    if(game.cd>0){game.cd=Math.max(0,game.cd-dt);return;}
    simStep(dt);
    if(game.time>=maxSeconds&&!game.over){game.reason='time';endGameOwner(2);}
  }
  function join(owner,siteId,army={}){
    const site=game.sites[siteId];
    if(game.over||!Number.isInteger(owner)||owner<3||owner>4||game.par[owner]||!site||site.owner!==0||site.kind==='central')return false;
    const level=army.level??game.armies[1].level,armyPower=army.power??game.armies[1].power;
    if(!Number.isInteger(level)||level<1||level>10||!Number.isFinite(armyPower)||armyPower<=0||armyPower>10)return false;
    let troops;try{troops=cloneTroops(army.troops);}catch{return false;}
    let loadout;try{loadout=selected(army.loadout);}catch{return false;}
    game.armies[owner]={level,power:armyPower,...(troops?{troops}:{}),...(expanded?{loadout}:{})};
    game.par[owner]={...game.par[1]};game.dropM[owner]=.35;game.joinedOwners.push(owner);
    site.owner=owner;site.troops=25;site.hq=true;site.cd=0;specialize(site);
    return true;
  }
  function leave(owner){
    if(game.over||owner===2||!game.par[owner]||game.forfeited.includes(owner))return false;
    game.forfeited.push(owner);
    for(const site of game.sites)if(site.owner===owner){site.owner=0;site.hq=false;site.troops=Math.floor(site.troops);site.fortification=0;specialize(site);}
    game.units=game.units.filter(unit=>unit.owner!==owner);
    game.fights=game.fights.filter(f=>{if(f.a.owner===owner||f.b.owner===owner){f.a.fight=null;f.b.fight=null;return false;}return true;});
    return true;
  }
  function snapshot(){
    return {time:game.time,cd:game.cd,over:game.over,result:game.result,reason:game.reason||null,winnerOwner:game.winnerOwner,joinedOwners:game.joinedOwners.slice(),forfeited:game.forfeited.slice(),activeOwners:Object.keys(game.par).map(Number).filter(alive),
      defenderShare:setup.defenderShare,par:game.par,dropM:game.dropM,armies:game.armies,
      sites:game.sites.map(s=>({id:s.id,owner:s.owner,troops:s.troops,hq:s.hq,tx:s.tx,ty:s.ty,...(expanded?{kind:s.kind,fortification:s.fortification||0}:{})})),
      units:game.units.map(u=>({id:u.id,k:u.k,owner:u.owner,n:u.n,P:u.P,cum:u.cum,L:u.L,d:u.d,si:u.si,x:u.x,y:u.y,alive:u.alive,
        fighting:u.fight?(u.fight.a===u?u.fight.b.id:u.fight.a.id):null})),
      fx:game.fx.map(f=>({type:f.type,x:f.x,y:f.y,t:f.t,c:f.c,o:f.o,text:f.text,heli:f.heli,site:f.s?.id,from:f.from?.id,to:f.to?.id})),
      stats:game.stats,...(expanded?{participation:{...game.participation},objectives:JSON.parse(JSON.stringify(game.objectives))}:{})};
  }
  function checkpoint(){
    return {version:1,config:{share,difficulty,seed,maxSeconds,centralOwner,defenderBaseCount,attackerPower,defenderPower,neutralPower,attackerLevel,defenderLevel,balanceVersion,...(expanded?{attackerLoadout,defenderLoadout}:{}),...(mapId?{mapId}:{}),...(combatVersion?{combatVersion}:{}),...(defenseVersion?{defenseVersion}:{}),...(attackerTroops?{attackerTroops}:{}),...(defenderTroops?{defenderTroops}:{}),...(neutralTroops?{neutralTroops}:{})},randomState:random.state(),
      objectives:JSON.parse(JSON.stringify(game.objectives)),participation:{...game.participation},time:game.time,uid:game.uid,cd:game.cd,over:game.over,result:game.result,reason:game.reason,winnerOwner:game.winnerOwner,joinedOwners:game.joinedOwners.slice(),forfeited:game.forfeited.slice(),par:JSON.parse(JSON.stringify(game.par)),
      stats:{...game.stats},dropM:{...game.dropM},ais:game.ais.map(a=>({...a})),armies:JSON.parse(JSON.stringify(game.armies)),
      sites:game.sites.map(s=>({...s})),
      units:game.units.map(({to,fight,...u})=>({...u,toId:to.id})),
      fights:game.fights.map(({a,b,...f})=>({...f,aId:a.id,bId:b.id}))};
  }
  function restore(saved){
    if(saved.version!==1)throw new Error('Unsupported battle checkpoint');
    for(const key of ['time','uid','cd','over','result','reason','stats','dropM','ais'])game[key]=saved[key];
    game.winnerOwner=saved.winnerOwner??(saved.result==='won'?1:saved.result==='lost'?2:null);game.joinedOwners=saved.joinedOwners||[];game.forfeited=saved.forfeited||[];if(saved.par)game.par=JSON.parse(JSON.stringify(saved.par));
    if(saved.objectives)game.objectives=JSON.parse(JSON.stringify(saved.objectives));
    if(saved.participation)game.participation={...saved.participation};
    if(saved.armies)game.armies=JSON.parse(JSON.stringify(saved.armies));
    game.sites=saved.sites.map(s=>({...s}));
    game.units=saved.units.map(({toId,...u})=>({...u,to:game.sites[toId],fight:null}));
    const units=new Map(game.units.map(u=>[u.id,u]));
    game.fights=saved.fights.map(({aId,bId,...f})=>({...f,a:units.get(aId),b:units.get(bId)})).filter(f=>f.a&&f.b);
    for(const fight of game.fights){fight.a.fight=fight;fight.b.fight=fight;}
    game.fx=[];random.restore(saved.randomState);
  }
  return {step,command,join,leave,snapshot,checkpoint,restore,setDefenderControlled(value){defenderControlled=!!value;},get result(){return game.result;}};
}
function restoreBattle(saved){const battle=createBattle(saved.config);battle.restore(saved);return battle;}
// Read-only catalog metadata uses the same constants as combat.
module.exports={createBattle,restoreBattle,initialSites,weights,MAPDATA,maps,combatRules:{version:troopRules.COMBAT_VERSION,defenseVersion:CAPITAL_DEFENSE_VERSION,speed:SPEED,range:RANGE,fire:FIRE,hexRadius:HR}};
