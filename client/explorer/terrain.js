import {createCanvasTerrain} from './terrain-fallback.js';
// A small WebGL texture pass shares D3's camera. Geography, interaction and
// selection remain on the 2D canvas; no extra 3D engine or render loop is used.
export function createTerrain(onReady){
 const surface=document.createElement('canvas'),gl=surface.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
 if(!gl)return createCanvasTerrain(onReady);
 const vertex=`attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}`;
 const fragment=`precision highp float;
 uniform sampler2D earth;uniform vec2 pixels;uniform vec2 size;uniform vec2 center;uniform float scale;uniform vec2 rotation;uniform float spherical;
 const float PI=3.141592653589793;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 void main(){
  vec2 p=gl_FragCoord.xy/pixels*size;float lon,lat,light=1.;
  if(spherical>.5){
   vec2 q=(p-vec2(center.x,size.y-center.y))/scale;float radius=dot(q,q);if(radius>1.)discard;
   float front=sqrt(max(0.,1.-radius));float cp=cos(rotation.y),sp=sin(rotation.y),cl=cos(rotation.x),sl=sin(rotation.x);
   float X1=front*cp+q.y*sp,Z=q.y*cp-front*sp;
   float X=X1*cl+q.x*sl,Y=q.x*cl-X1*sl;lon=atan(Y,X);lat=asin(clamp(Z,-1.,1.));
   light=.78+.22*max(0.,dot(normalize(vec3(q.x,q.y,front)),normalize(vec3(-.35,.45,1.))));
   light*=1.-.28*pow(radius,3.);
  }else{vec2 q=(vec2(p.x,size.y-p.y)-center)/scale;lon=q.x-rotation.x;lat=2.*atan(exp(-q.y))-PI/2.;}
  vec2 uv=vec2(fract(lon/(2.*PI)+.5),.5-lat/PI);vec3 color=texture2D(earth,uv).rgb;
  float water=smoothstep(.005,.1,color.b-max(color.r,color.g*.9));
  vec3 ocean=mix(vec3(.025,.24,.48),vec3(.015,.5,.62),spherical<.5?.6:.15);
  color=mix(color*1.14,ocean,water*.62);
  float vegetation=smoothstep(.01,.13,color.g-color.r*.9)*(1.-water);
  color=mix(color,vec3(color.r*.7,color.g*1.18,color.b*.74),vegetation*.55);
  float luminance=dot(color,vec3(.21,.72,.07));color=mix(vec3(luminance),color,1.18);
  color*=1.+(hash(floor(uv*3000.))-.5)*.075*(1.-water);
  gl_FragColor=vec4(clamp(color*light,0.,1.),1.);
 }`;
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Terrain shader unavailable');return s;}
 let program;try{program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Terrain unavailable');}catch{return createCanvasTerrain(onReady);}
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);gl.useProgram(program);const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const uniforms=Object.fromEntries(['earth','pixels','size','center','scale','rotation','spherical'].map(name=>[name,gl.getUniformLocation(program,name)]));
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 let loaded=false,lost=false;const image=new Image();image.onload=()=>{try{gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);loaded=true;onReady();}catch{loaded=false;}};image.src='/explorer/art/earth-day.jpg';
 surface.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;onReady();});
 return {ready:()=>loaded&&!lost,draw(width,height,camera,rotation,spherical){if(!loaded||lost)return null;const dpr=Math.min(devicePixelRatio||1,1.5),w=Math.round(width*dpr),h=Math.round(height*dpr);if(surface.width!==w||surface.height!==h){surface.width=w;surface.height=h;}gl.viewport(0,0,w,h);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1i(uniforms.earth,0);gl.uniform2f(uniforms.pixels,w,h);gl.uniform2f(uniforms.size,width,height);gl.uniform2f(uniforms.center,camera.x,camera.y);gl.uniform1f(uniforms.scale,camera.scale);gl.uniform2f(uniforms.rotation,rotation[0]*Math.PI/180,rotation[1]*Math.PI/180);gl.uniform1f(uniforms.spherical,spherical?1:0);gl.drawArrays(gl.TRIANGLES,0,6);return surface;}};
}
