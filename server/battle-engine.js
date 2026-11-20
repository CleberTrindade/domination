// Reuses the original map, movement, combat and CPU rules from the classic game.
'use strict';
const MAPDATA = require('../shared/map.json');
const MW=390,MAPY=70,MAPH=640,HR=26;
const KIND={P:'garagem',G:'garagem',H:'heli',B:'botes',A:'canhao',C:'central'};
const PCT={garagem:.40,heli:.55,botes:.45,canhao:.55,central:.55};
const BASE0=25,RANGE={central:HR*3.5,canhao:HR*2.6},FIRE={central:.42,canhao:.95};
const SPEED={tanque:42,desliz:52,heli:62};
const HX=(()=>{
  const cells=MAPDATA.cells.map(([c,r,x,y,t])=>({c,r,x,y:y-MAPY,t}));
  const key=(c,r)=>c+','+r,idx=new Map();cells.forEach((q,i)=>idx.set(key(q.c,q.r),i));
  const DIRS=[[2,0],[-2,0],[1,-1],[-1,-1],[1,1],[-1,1]];
  const nb=cells.map(q=>DIRS.map(([a,b])=>idx.get(key(q.c+a,q.r+b))).filter(v=>v!=null));
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
  return {cells,nb,seeds,comp,tcol,path,corners,center:seeds.findIndex(s=>s.n==='C')};
})();

const weights=HX.seeds.map((_,id)=>HX.cells.filter(c=>c.t===id).length);
function seeded(seed){const random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};random.state=()=>seed;random.restore=value=>{seed=value|0;};return random;}
const initialCache=new Map();
function initialSites(share,difficulty=1,centralOwner=0,defenderBaseCount=null){
  const cacheKey=[share,difficulty,centralOwner,defenderBaseCount].join(':');
  if(initialCache.has(cacheKey)){const cached=initialCache.get(cacheKey);return {...cached,sites:cached.sites.map(site=>({...site}))};}
  const sites=HX.seeds.map((s,id)=>{const c=HX.cells[s.cell];return{id,x:c.x,y:c.y,cell:s.cell,kind:s.kind,n:s.n,owner:0,troops:Math.round(BASE0*PCT[s.kind]),hq:false,cd:0}});
  const attacker=HX.corners[0],defender=HX.corners[1],target=share*HX.cells.length;
  const candidates=sites.filter(s=>s.id!==attacker&&s.id!==defender&&s.id!==HX.center);
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
  attackerPower=1,defenderPower=1,neutralPower=1,attackerLevel=1,defenderLevel=1,balanceVersion=null}={}){
  if([attackerPower,defenderPower,neutralPower].some(power=>!Number.isFinite(power)||power<=0||power>10))throw Error('Invalid army power');
  if(!Number.isInteger(attackerLevel)||attackerLevel<1||attackerLevel>10||defenderLevel!==null&&(!Number.isInteger(defenderLevel)||defenderLevel<1||defenderLevel>10))throw Error('Invalid army level');
  let defenderControlled=false;
  const random=seeded(seed),setup=initialSites(share,difficulty,centralOwner,defenderBaseCount);
  const aip={prod:.65+difficulty*.045,cap:50,int:Math.max(1.8,3.6-difficulty*.25),aggr:.55};
  const game={sites:setup.sites,units:[],fights:[],fx:[],time:0,uid:0,me:1,mode:'solo',over:false,result:null,winnerOwner:null,joinedOwners:[],forfeited:[],cd:3,
    stats:{cap:0,kill:0},dropM:{1:.35,2:.35},par:{1:{prod:1.2,cap:60},2:aip},aip,ais:[{id:2,timer:7,dead:false}],
    armies:{1:{level:attackerLevel,power:attackerPower},2:{level:defenderLevel,power:defenderPower}}};
  const power=owner=>owner===0?neutralPower:game.armies[owner]?.power||1;
  const toast=()=>{};
  function endGameOwner(owner){if(!game.over){game.over=true;game.winnerOwner=owner;game.result=owner===2?'lost':'won';}}
const unitKind=s=>s.kind==='heli'?'heli':s.kind==='botes'?'desliz':'tanque';
const canReach=(a,b)=>!!a&&!!b&&a!==b&&(unitKind(a)!=='tanque'||HX.comp[a.cell]===HX.comp[b.cell]);
function mkPath(a,b,k){
  const P=k==='tanque'?HX.path(a.cell,b.cell):[[a.x,a.y],[b.x,b.y]];
  const cum=[0];for(let i=1;i<P.length;i++){const dx=P[i][0]-P[i-1][0],dy=P[i][1]-P[i-1][1];cum.push(cum[i-1]+Math.sqrt(dx*dx+dy*dy))}
  return {P,cum,L:cum[cum.length-1]};
}
function send(from,to){
  const g=game;if(!canReach(from,to))return;
  const n=Math.floor(from.troops);if(n<1)return;
  const k=unitKind(from),path=mkPath(from,to,k);if(path.L<=0)return;
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
  if(b.owner===u.owner){b.troops+=u.n;return}
  if(u.owner===g.me&&b.owner!==0)g.stats.kill+=Math.min(u.n,Math.floor(b.troops));
  b.troops-=u.n*power(u.owner)/power(b.owner);
  if(b.troops<0){
    b.troops=-b.troops*power(b.owner)/power(u.owner);b.owner=u.owner;b.hq=false;g.dirty=true;
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
    const need=(t.troops+grow)*power(t.owner)/power(ai.id)+danger(t,ai.id)+2;
    let sum=0,use=[];for(const s of srcs){if(sum>=need*1.15)break;use.push(s);sum+=Math.floor(s.troops)}
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
  for(const s of g.sites){
    if(s.owner===0)continue;
    const P=g.par[s.owner];
    if(s.troops<P.cap)s.troops=Math.min(P.cap,s.troops+P.prod*dt*(s.hq?1.25:1));
    else s.troops=Math.max(P.cap,s.troops-dt*1.5);
  }
  for(const u of g.units){
    u.px=u.x;u.py=u.y;
    if(u.fight)continue;               // em batalha: fica parado
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
      f[k]+=0.3;tg.n-=power(sh.owner);sh.kick=0;
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
    s.cd=FIRE[s.kind];best.n-=power(s.owner);s.tx=best.x;s.ty=best.y;s.kick=0;
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
      }return sent;
    }
    if(action.type==='drop'&&Number.isInteger(action.site)){
      const s=game.sites[action.site];if(!s||s.owner!==owner||game.dropM[owner]<1)return false;
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
    game.armies[owner]={level,power:armyPower};
    game.par[owner]={...game.par[1]};game.dropM[owner]=.35;game.joinedOwners.push(owner);
    site.owner=owner;site.troops=25;site.hq=true;site.cd=0;
    return true;
  }
  function leave(owner){
    if(game.over||owner===2||!game.par[owner]||game.forfeited.includes(owner))return false;
    game.forfeited.push(owner);
    for(const site of game.sites)if(site.owner===owner){site.owner=0;site.hq=false;site.troops=Math.floor(site.troops);}
    game.units=game.units.filter(unit=>unit.owner!==owner);
    game.fights=game.fights.filter(f=>{if(f.a.owner===owner||f.b.owner===owner){f.a.fight=null;f.b.fight=null;return false;}return true;});
    return true;
  }
  function snapshot(){
    return {time:game.time,cd:game.cd,over:game.over,result:game.result,reason:game.reason||null,winnerOwner:game.winnerOwner,joinedOwners:game.joinedOwners.slice(),forfeited:game.forfeited.slice(),activeOwners:Object.keys(game.par).map(Number).filter(alive),
      defenderShare:setup.defenderShare,par:game.par,dropM:game.dropM,armies:game.armies,
      sites:game.sites.map(s=>({id:s.id,owner:s.owner,troops:s.troops,hq:s.hq,tx:s.tx,ty:s.ty})),
      units:game.units.map(u=>({id:u.id,k:u.k,owner:u.owner,n:u.n,P:u.P,cum:u.cum,L:u.L,d:u.d,si:u.si,x:u.x,y:u.y,alive:u.alive,
        fighting:u.fight?(u.fight.a===u?u.fight.b.id:u.fight.a.id):null})),
      fx:game.fx.map(f=>({type:f.type,x:f.x,y:f.y,t:f.t,c:f.c,o:f.o,text:f.text,heli:f.heli,site:f.s?.id,from:f.from?.id,to:f.to?.id})),
      stats:game.stats};
  }
  function checkpoint(){
    return {version:1,config:{share,difficulty,seed,maxSeconds,centralOwner,defenderBaseCount,attackerPower,defenderPower,neutralPower,attackerLevel,defenderLevel,balanceVersion},randomState:random.state(),
      time:game.time,uid:game.uid,cd:game.cd,over:game.over,result:game.result,reason:game.reason,winnerOwner:game.winnerOwner,joinedOwners:game.joinedOwners.slice(),forfeited:game.forfeited.slice(),par:JSON.parse(JSON.stringify(game.par)),
      stats:{...game.stats},dropM:{...game.dropM},ais:game.ais.map(a=>({...a})),armies:JSON.parse(JSON.stringify(game.armies)),
      sites:game.sites.map(s=>({...s})),
      units:game.units.map(({to,fight,...u})=>({...u,toId:to.id})),
      fights:game.fights.map(({a,b,...f})=>({...f,aId:a.id,bId:b.id}))};
  }
  function restore(saved){
    if(saved.version!==1)throw new Error('Unsupported battle checkpoint');
    for(const key of ['time','uid','cd','over','result','reason','stats','dropM','ais'])game[key]=saved[key];
    game.winnerOwner=saved.winnerOwner??(saved.result==='won'?1:saved.result==='lost'?2:null);game.joinedOwners=saved.joinedOwners||[];game.forfeited=saved.forfeited||[];if(saved.par)game.par=JSON.parse(JSON.stringify(saved.par));
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
module.exports={createBattle,restoreBattle,initialSites,weights,MAPDATA};
