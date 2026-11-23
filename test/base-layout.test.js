'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),path=require('node:path');
const manifest=require('../public/art/battle-sprites/manifest.json');
test('every visible base pixel and all cannon headings and recoil positions stay inside the hexagon',async()=>{
  function contained(sheet,index,placement,dx=0,dy=0){
    const {data,info,meta}=sheet,left=index%meta.cols*meta.w,top=Math.floor(index/meta.cols)*meta.h;
    for(let y=0;y<meta.h;y++)for(let x=0;x<meta.w;x++)if(data[((top+y)*info.width+left+x)*4+3]){
      const px=(meta.vb[0]+(x+.5)/3+dx)*placement.scale,py=(meta.vb[1]+(y+.5)/3+dy)*placement.scale+placement.offsetY;
      assert(Math.abs(px)<26*Math.sqrt(3)/2-.5,'outside a side edge');assert(Math.abs(py)+Math.abs(px)/Math.sqrt(3)<25.5,'outside a diagonal edge');
    }
  }
  for(let owner=0;owner<5;owner++){
    const sheets={};
    for(const key of ['bases'+owner,'turret'+owner]){const meta=manifest.atlases[key];sheets[key]={meta,...await sharp(path.join(__dirname,'../public/art/battle-sprites',meta.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})};}
    for(const [index,kind] of manifest.bases.entries())contained(sheets['bases'+owner],index,manifest.baseLayout[kind]);
    for(let i=0;i<32;i++)for(const recoil of [0,3])contained(sheets['turret'+owner],i,manifest.baseLayout.canhao,-Math.cos(i*Math.PI/16)*recoil,-Math.sin(i*Math.PI/16)*.6*recoil);
  }
});
