'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const art=require('../public/troop-art');
test('concept artwork rotates and recolors all cached battle directions without clipping or changing simulation data',()=>{
  for(const kind of ['tanque','desliz','heli'])for(let owner=0;owner<5;owner++)for(let direction=0;direction<32;direction++){
    const h=direction*Math.PI/16,options={noShadow:true,noRotor:true,lift:kind==='heli'?12:1};
    const svg=art.unit3d(kind,owner,h,0,1,options);
    assert(svg.includes('<path'));assert(!/NaN|Infinity|undefined/.test(svg));
    assert.equal(svg,art.unit3d(kind,owner,h,0,1,options));
    for(const match of svg.matchAll(/ d="([MLZ\d.\- ]+)"/g)){
      const values=(match[1].match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
      for(let i=0;i<values.length;i+=2){assert(values[i]>=-30&&values[i]<=30,kind+' x');assert(values[i+1]>=-38&&values[i+1]<=13,kind+' y');}
    }
  }
  assert.notEqual(art.unit3d('tanque',1,.3),art.unit3d('tanque',2,.3));
  assert.notEqual(art.unit3d('heli',1,.3),art.unit3d('heli',1,1.4));
  assert(!art.unit3d('heli',1,0,0,1,{noRotor:true}).includes('stroke-linecap="round"'));
});
test('fixed weapons attach projectiles to the new rotating barrel and all six central muzzles',()=>{
  assert.equal(art.centralGuns.length,6);assert.equal(new Set(art.centralGuns.map(g=>g.deg)).size,6);
  for(const g of art.centralGuns){assert(Number.isFinite(g.mx)&&Number.isFinite(g.my));assert(Math.abs(g.mx)<=30);assert(g.my<18&&g.my>-46);}
  const east=art.turretMuzzle(0),west=art.turretMuzzle(Math.PI),south=art.turretMuzzle(Math.PI/2);
  assert(Math.abs(east[0]+west[0])<1e-9);assert(Math.abs(east[1]-west[1])<1e-9);assert(south[1]>east[1]);
  assert(!art.building('canhao',1,1,{part:'base'}).includes('aturret'));
  assert(art.building('canhao',1,1,{part:'turret',h:0}).includes('aturret'));
});
test('install preserves production buildings and exposes the approved portraits without adding troops',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),start=html.indexOf('window.DSPR='),ctx={window:{}};
  vm.runInNewContext(html.slice(start,html.indexOf('</script>',start)),ctx);
  const D=ctx.window.DSPR,before=D.S.building('garagem',1);
  art.install(D);assert.equal(D.artVersion,'concept-3d');assert.equal(D.S.building('garagem',1),before);assert.equal(D.S.CGUN,art.centralGuns);
  const once=D.S.building;art.install(D);assert.equal(D.S.building,once);
  for(const kind of ['tanque','desliz','heli','canhao','central']){
    assert(art.card(kind).includes('data-art="concept-3d"'));assert(!art.card(kind).includes('<text'));
  }
  assert.equal(art.card('batedor'),'');assert.equal(art.unit3d('batedor',1),'');
  assert(html.indexOf('src="/troop-art.js"')>start);assert(html.indexOf('src="/troop-art.js"')<html.indexOf('const SPR='));
  const source=fs.readFileSync(require.resolve('../server/index'),'utf8');assert(source.includes("['/troop-art.js'"));
  for(const name of ['troops-initial-v1.png','central-v1.png']){
    const file=fs.readFileSync(require.resolve('../public/art/'+name));assert.equal(file.subarray(1,4).toString(),'PNG');assert(source.includes("['/art/"+name+"'"));
  }
});
