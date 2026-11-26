// Canvas fallback for browsers without WebGL. Flat maps are baked once; the
// small globe texture is sampled at most 12 times/s while vectors stay crisp.
export function createCanvasTerrain(onReady){
 const surface=document.createElement('canvas'),ctx=surface.getContext('2d');
 const texture=document.createElement('canvas'),source=texture.getContext('2d',{willReadFrequently:true});
 const mercator=document.createElement('canvas'),flat=mercator.getContext('2d');
 const sphere=document.createElement('canvas'),sphereCtx=sphere.getContext('2d');
 let data=null,tw=0,th=0,last=0,lastRotation='',globePixels=null,grid=null;
 const image=new Image();image.onload=()=>{
  tw=image.naturalWidth;th=image.naturalHeight;texture.width=tw;texture.height=th;source.drawImage(image,0,0);
  data=source.getImageData(0,0,tw,th).data;mercator.width=1024;mercator.height=1024;
  const pixels=flat.createImageData(1024,1024);
  for(let y=0;y<1024;y++){
   const lat=2*Math.atan(Math.exp(Math.PI-y/1024*2*Math.PI))-Math.PI/2;
   const row=Math.min(th-1,Math.max(0,Math.floor((.5-lat/Math.PI)*th)))*tw;
   for(let x=0;x<1024;x++){const src=(row+Math.floor(x/1024*tw))*4,dst=(y*1024+x)*4;pixels.data[dst]=data[src];pixels.data[dst+1]=data[src+1];pixels.data[dst+2]=data[src+2];pixels.data[dst+3]=255;}
  }
  flat.putImageData(pixels,0,0);onReady();
 };image.src='/explorer/art/earth-day.jpg';
 return {ready:()=>!!data,draw(width,height,camera,rotation,spherical){
  if(!data)return null;
  if(surface.width!==Math.round(width)||surface.height!==Math.round(height)){surface.width=Math.round(width);surface.height=Math.round(height);}
  ctx.clearRect(0,0,width,height);
  if(!spherical){
   const size=2*Math.PI*camera.scale,x=camera.x+rotation[0]*Math.PI/180*camera.scale-Math.PI*camera.scale,y=camera.y-Math.PI*camera.scale;
   for(let copy=-1;copy<=1;copy++)ctx.drawImage(mercator,x+copy*size,y,size,size);
   return surface;
  }
  const n=Math.min(320,Math.max(160,Math.round(camera.scale*2))),now=performance.now(),key=rotation.map(v=>v.toFixed(3)).join(',');
  if(sphere.width!==n){sphere.width=n;sphere.height=n;globePixels=sphereCtx.createImageData(n,n);grid=new Float32Array(n*n*3);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const qx=(x+.5)/n*2-1,qy=1-(y+.5)/n*2,r=qx*qx+qy*qy,i=(y*n+x)*3;grid[i]=qx;grid[i+1]=qy;grid[i+2]=r<=1?Math.sqrt(1-r):-1;}last=0;}
  if(now-last>1000/12&&key!==lastRotation||last===0){
   const a=rotation[0]*Math.PI/180,b=rotation[1]*Math.PI/180,cl=Math.cos(a),sl=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b),out=globePixels.data;
   for(let i=0,p=0;i<grid.length;i+=3,p+=4){const front=grid[i+2];if(front<0){out[p+3]=0;continue;}const qx=grid[i],qy=grid[i+1],x1=front*cp+qy*sp,z=qy*cp-front*sp,X=x1*cl+qx*sl,Y=qx*cl-x1*sl;
    const u=((Math.atan2(Y,X)/(2*Math.PI)+.5)%1+1)%1,v=.5-Math.asin(Math.max(-1,Math.min(1,z)))/Math.PI;
    const src=(Math.min(th-1,Math.floor(v*th))*tw+Math.min(tw-1,Math.floor(u*tw)))*4,shade=(.76+.24*Math.max(0,(-.35*qx+.45*qy+front)/1.15))*(1-.24*Math.pow(1-front*front,3));
    out[p]=data[src]*shade;out[p+1]=data[src+1]*shade;out[p+2]=data[src+2]*shade;out[p+3]=255;
   }
   sphereCtx.putImageData(globePixels,0,0);last=now;lastRotation=key;
  }
  ctx.drawImage(sphere,camera.x-camera.scale,camera.y-camera.scale,camera.scale*2,camera.scale*2);return surface;
 }};
}
