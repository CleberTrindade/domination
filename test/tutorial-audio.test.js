'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {narrationScripts}=require('../scripts/tutorial-narration'),manifest=require('../public/tutorial-audio.json'),{createApplication}=require('../server');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
test('every training and tour instruction has a current, complete fixed male recording with immutable filename',()=>{
 assert.equal(manifest.voice.gender,'male');assert.equal(manifest.voice.language,'pt-BR');const scripts=narrationScripts();assert.equal(manifest.clips.length,scripts.length);
 for(const script of scripts){
  const clip=manifest.clips.find(c=>c.text===script.text);assert(clip,'missing recording: '+script.text);assert.equal(clip.sha256,script.sha256);
  const bytes=fs.readFileSync(path.join(__dirname,'../public/audio/tutorial',clip.file));assert.equal(bytes.length,clip.bytes);assert.equal(digest(bytes),clip.audioSha256);assert.equal(clip.file,script.sha256.slice(0,16)+'-'+clip.audioSha256.slice(0,8)+'.mp3');assert(clip.duration>1);assert(bytes.length>1000);
 }
});
test('commander and MP3 assets are served with proper type, cache, HEAD and byte ranges for mobile players',async t=>{
 const app=await createApplication({pool:null,worldOptions:{startClock:false}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
 const clip=manifest.clips[0],url=base+'/audio/tutorial/'+clip.file,bytes=fs.readFileSync(path.join(__dirname,'../public/audio/tutorial',clip.file));
 const complete=await fetch(url);assert.equal(complete.status,200);assert.match(complete.headers.get('content-type'),/audio\/mpeg/);assert.match(complete.headers.get('cache-control'),/immutable/);assert.equal(complete.headers.get('accept-ranges'),'bytes');assert.deepEqual(Buffer.from(await complete.arrayBuffer()),bytes);
 const range=await fetch(url,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-99/'+bytes.length);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,100));
 const head=await fetch(url,{method:'HEAD'});assert.equal(+head.headers.get('content-length'),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 const bad=await fetch(url,{headers:{Range:'bytes=999999999-'}});assert.equal(bad.status,416);
 const image=await fetch(base+'/art/tutorial-commander-v1.webp');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert((await image.arrayBuffer()).byteLength>1000);
 const catalog=await fetch(base+'/tutorial-audio.js');assert.equal(catalog.status,200);assert((await catalog.text()).includes(clip.file));
});
