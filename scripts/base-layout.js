'use strict';
const sharp=require('sharp'),path=require('node:path');
// Fit the actual opaque silhouette inside all six hexagon half-planes.
async function baseLayout(manifest,directory){
  const sheets={};
  for(const key of ['bases0','turret0']){
    const meta=manifest.atlases[key];
    sheets[key]={meta,...await sharp(path.join(directory,meta.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})};
  }
  function points(sheet,index,shiftX=0,shiftY=0){
    const {meta,data,info}=sheet,result=[];
    const left=index%meta.cols*meta.w,top=Math.floor(index/meta.cols)*meta.h;
    for(let y=0;y<meta.h;y++)for(let x=0;x<meta.w;x++)if(data[((top+y)*info.width+left+x)*4+3]){
      result.push([meta.vb[0]+(x+.5)/3+shiftX,meta.vb[1]+(y+.5)/3+shiftY]);
    }
    return result;
  }
  const result={},radius=24; // 2 map pixels of clearance from the hex outline.
  for(const [index,kind] of manifest.bases.entries()){
    const silhouette=points(sheets.bases0,index);
    if(kind==='canhao')for(let i=0;i<32;i++)for(const recoil of [0,3]){
      const angle=i*Math.PI/16;silhouette.push(...points(sheets.turret0,i,-Math.cos(angle)*recoil,-Math.sin(angle)*.6*recoil));
    }
    let high=-Infinity,low=Infinity,wide=0;
    for(const [x,y] of silhouette){
      // Include the whole source pixel and a bilinear filtering margin.
      const edge=Math.abs(x)+1/3;
      high=Math.max(high,y+edge/Math.sqrt(3)+1/3);low=Math.min(low,y-edge/Math.sqrt(3)-1/3);wide=Math.max(wide,edge);
    }
    const scale=Math.min(radius*Math.sqrt(3)/2/wide,2*radius/(high-low));
    result[kind]={scale,offsetY:-(high+low)/2*scale};
  }
  return result;
}
module.exports={baseLayout};
