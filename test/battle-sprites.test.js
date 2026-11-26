'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const manifest=require('../public/art/battle-sprites/manifest.json');
function renderer(){
  const images=[];
  class Image{constructor(){images.push(this);}}
  const window={DOMINATION_SPRITE_MANIFEST:manifest};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/battle-sprites'),'utf8'),{window,Image});
  return {sprites:window.DOMINATION_BATTLE_SPRITES,images};
}
test('battle directions share one lazily loaded bitmap with the same viewport and angle as the SVG renderer',()=>{
  const {sprites,images}=renderer();assert.equal(images.length,0);
  for(let col=0;col<5;col++)for(const kind of ['tanque','desliz','heli','batedor','foguetes','blindado','antiaereo','engenheiro','artilharia']){
    const start=images.length,first=sprites.unit(kind,col,0);assert.equal(first.ok,false);
    images.at(-1).onload();assert.equal(first.ok,true);
    for(let i=0;i<32;i++){
      const entry=sprites.unit(kind,col,i*Math.PI/16);
      assert.equal(entry.im,first.im);assert.equal(entry.sx,i%8*180);assert.equal(entry.sy,Math.floor(i/8)*186);
      assert.deepEqual(Array.from(entry.vb),[-30,-50,60,62]);
      assert.equal(entry,sprites.unit(kind,col,i*Math.PI/16+Math.PI*2));
    }
    assert.equal(images.length,start+1,'32 headings decode one bitmap');
    assert.equal(sprites.unit(kind,col,-Math.PI/16),sprites.unit(kind,col,31*Math.PI/16));
  }
  assert.equal(sprites.unit('invalid',1,0),null);
});
test('bases and rotating turrets retain source coordinates and failed images fall back to the existing vector art',()=>{
  const {sprites,images}=renderer();
  const first=sprites.building('quartel',1);
  for(const kind of manifest.bases)assert.equal(sprites.building(kind,1).im,first.im);
  assert.equal(images.length,1);images[0].onerror();
  for(const kind of manifest.bases)assert.equal(sprites.building(kind,1),null);
  assert.equal(sprites.building('invalid',1),null);
  const turret=sprites.turret(2,Math.PI);assert.equal(turret.sx,0);assert.equal(turret.sy,384);assert.equal(turret.sh,192);
  images.at(-1).onload();assert.equal(turret.ok,true);
});
test('every referenced immutable bitmap exists, covers all frames and preserves the approved art losslessly',async()=>{
  const sharp=require('sharp'),art=require('../public/troop-art');
  assert.equal(Object.keys(manifest.atlases).length,55);
  for(const [key,meta] of Object.entries(manifest.atlases)){
    assert(/^[a-z0-9-]+-[a-f0-9]{12}\.webp$/.test(meta.file));
    const file=path.join(__dirname,'../public/art/battle-sprites',meta.file),metadata=await sharp(file).metadata();
    assert.equal(metadata.width,meta.cols*meta.w);assert.equal(metadata.height,Math.ceil(meta.count/meta.cols)*meta.h);assert(metadata.hasAlpha);
    const index=key.startsWith('bases')?6:11,col=Number(key.at(-1)),h=index*Math.PI/16;
    const source=key.startsWith('bases')?art.building(manifest.bases[index],col,1,{part:'base'}):key.startsWith('turret')?art.building('canhao',col,1,{part:'turret',h}):art.unit3d(key.slice(0,-1),col,h,0,1,{noShadow:1,noRotor:1,lift:key.startsWith('heli')?12:1});
    const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.w}" height="${meta.h}" viewBox="${meta.vb.join(' ')}">${source}</svg>`);
    // Composite on the same transparent surface before comparing alpha edges.
    const expected=await sharp({create:{width:meta.w,height:meta.h,channels:4,background:'#00000000'}}).composite([{input:await sharp(svg).png().toBuffer()}]).raw().toBuffer();
    const actual=await sharp(file).extract({left:index%meta.cols*meta.w,top:Math.floor(index/meta.cols)*meta.h,width:meta.w,height:meta.h}).raw().toBuffer();
    // WebP may discard RGB in fully transparent pixels; those do not affect drawing.
    for(let p=0;p<actual.length;p+=4){
      assert.equal(actual[p+3],expected[p+3],key+' alpha');
      if(actual[p+3])for(let channel=0;channel<3;channel++)assert.equal(actual[p+channel],expected[p+channel],key+' color');
    }
  }
});
test('the HTTP application serves the manifest, renderer and hash-named images with immutable caching',async t=>{
  const {createApplication}=require('../server/index');
  const app=await createApplication({pool:null,worldOptions:{startClock:false}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  for(const resource of ['/battle-sprites.js','/battle-sprites-manifest.js']){
    const response=await fetch(base+resource);assert.equal(response.status,200);assert(response.headers.get('content-type').includes('javascript'));new vm.Script(await response.text());
  }
  const meta=Object.values(manifest.atlases)[0],response=await fetch(base+'/art/battle-sprites/'+meta.file);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');
  const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.equals(fs.readFileSync(path.join(__dirname,'../public/art/battle-sprites',meta.file))));
});
test('drawing stays near 60 FPS on high refresh screens without reducing simulation updates, and hidden tabs stop painting',()=>{
  const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
  const source=html.slice(html.indexOf('let last=performance.now(),lastPaint='),html.indexOf('\nrefreshAll();',html.indexOf('let last=performance.now(),lastPaint=')));
  for(const hz of [30,60,72,90,120,144]){
    let paints=0,steps=0,cameraSteps=0,callback;
    const document={hidden:false,body:{classList:{contains:()=>true}}};
    vm.runInNewContext(source,{performance:{now:()=>0},game:{mode:'world'},document,battleInput:{update(){cameraSteps++;}},frame(){steps++;},render(){paints++;},hud(){},requestAnimationFrame(fn){callback=fn;}});
    for(let i=1;i<=hz*5;i++)callback(i*1000/hz);
    assert(Math.abs(paints-Math.min(hz,60)*5)<=2,hz+' Hz produced '+paints+' frames');assert.equal(steps,hz*5);
    assert.equal(cameraSteps,hz*5,'edge scrolling updates with the display clock');
    document.hidden=true;const before=paints;callback(6000);assert.equal(paints,before);assert.equal(steps,hz*5+1);assert.equal(cameraSteps,hz*5,'hidden tabs stop camera movement');
  }
});
