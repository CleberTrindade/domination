'use strict';
// Bake the approved vector art once, outside the player's animation loop.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('sharp'),art=require('../public/troop-art');
const {baseLayout}=require('./base-layout');
const kinds=['tanque','desliz','heli','batedor','foguetes','blindado','antiaereo','engenheiro','artilharia'];
const bases=['quartel','garagem','heli','botes','canhao','central','batedor','foguetes','blindado','antiaereo','engenheiro','artilharia'];
const output=path.join(__dirname,'../public/art/battle-sprites');
async function atlas(name,vb,count,make){
  const scale=3,cols=8,w=vb[2]*scale,h=vb[3]*scale;
  const tiles=[];
  for(let i=0;i<count;i++){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb.join(' ')}">${make(i)}</svg>`;
    tiles.push({input:await sharp(Buffer.from(svg)).png().toBuffer(),left:i%cols*w,top:Math.floor(i/cols)*h});
  }
  const data=await sharp({create:{width:cols*w,height:Math.ceil(count/cols)*h,channels:4,background:'#00000000'}}).composite(tiles).webp({lossless:true}).toBuffer();
  const file=name+'-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,12)+'.webp';
  await fs.writeFile(path.join(output,file),data);
  return {file,vb,cols,w,h,count};
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const atlases={};
  for(let col=0;col<5;col++){
    atlases['bases'+col]=await atlas('bases-'+col,[-30,-46,60,64],bases.length,i=>art.building(bases[i],col,1,{part:'base'}));
    atlases['turret'+col]=await atlas('turret-'+col,[-30,-46,60,64],32,i=>art.building('canhao',col,1,{part:'turret',h:i*Math.PI/16}));
    for(const kind of kinds)atlases[kind+col]=await atlas(kind+'-'+col,[-30,-50,60,62],32,i=>art.unit3d(kind,col,i*Math.PI/16,0,1,{noShadow:1,noRotor:1,lift:kind==='heli'?12:1}));
  }
  const manifest={version:1,bases,atlases};manifest.baseLayout=await baseLayout(manifest,output);
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Built '+Object.keys(atlases).length+' lossless sprite sheets.');
})().catch(error=>{console.error(error);process.exitCode=1;});
