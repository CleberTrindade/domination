import {destinationEnabled} from './pilot-policy.js';
import template from './template.html';
import {territoryCount,territoryLocations,municipalAreas,registerMunicipalAreas} from './territories.js';
import {geoOrthographic,geoMercator,geoPath,geoGraticule10,geoCentroid,geoContains,geoDistance,geoBounds,geoArea} from 'd3-geo';
import {CONTINENTS,wrap,alphabetical,continentCountries,initialCountryIndex,initialRegionIndex,flag,territoryNames,SERGIPE_POINTS} from './model.js';
import {normalizeGeometry} from './geometry.js';
import {createTerrain} from './terrain.js';
import {createStateView} from './state-view.js';
export function createExplorer(host,options){
const root=host.attachShadow({mode:'open'});root.innerHTML=template;
let worldData=options.data;
const $=id=>root.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d'),viewport=$('viewport');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const state={stage:0,continent:0,country:0,region:0,territory:0,tier:'initial',paused:reduced.matches,loading:true};
let world=[],countries=[],regions=[],width=0,height=0,projection=null,viewTarget=null,camera=null,dirty=true,lastFrame=0,lastPaint=0,holdUntil=performance.now()+4000,loadId=0,dragStart=null;
const terrain=createTerrain(()=>{dirty=true;});
const stateView=createStateView(()=>{dirty=true;});let stateMarkers=[];
const bases=[];
const regionCache=new Map(),graticule=geoGraticule10(),globe={type:'Sphere'},tiers={initial:{name:'Inicial',levels:'1–3'},middle:{name:'Intermediária',levels:'4–6'},advanced:{name:'Avançada',levels:'7–10'}};
const labels=['continente','país','região','território'];
function continent(){return CONTINENTS[state.continent];}
function country(){return countries[state.country];}
function region(){return regions[state.region];}
function selected(){return state.stage===0?continent():state.stage===1?country():state.stage===2?region():{id:String(state.territory),properties:{name:municipalAreas(region())?.[state.territory]?.properties.name||territoryNames(region())[state.territory]}};}
function items(){return state.stage===0?CONTINENTS.map(c=>({id:c.id,properties:{name:c.name}})):state.stage===1?countries:state.stage===2?regions:(municipalAreas(region())?.map(a=>a.properties.name)||territoryNames(region())).map((name,i)=>({id:String(i),properties:{name}}));}
function currentIndex(){return state[['continent','country','region','territory'][state.stage]];}
function featureCollection(features){return {type:'FeatureCollection',features};}
function currentFeatures(){return state.stage===0?world:state.stage===1?continentCountries(world,continent().id):state.stage===2?regions:[region()];}
function selectedFeature(){return state.stage===0?featureCollection(continentCountries(world,continent().id)):state.stage===1?country():region();}
function centerFor(feature){const p=feature.properties?.label;return p&&p.every(Number.isFinite)?p:geoCentroid(feature);}
function updateCamera(snap=false){
 if(!width||!world.length)return;
 if(state.stage===0){
  projection=geoOrthographic().precision(.7).clipAngle(90);
  const radius=Math.max(65,Math.min(width/2-19,height/2-15));
  viewTarget={scale:radius,x:width/2,y:height/2-2,rotation:[-continent().anchor[0],-continent().anchor[1]]};
 }else{
  projection=geoMercator().rotate([-continent().anchor[0],0]).precision(.6);
  const base=state.stage===1?featureCollection(countries):state.stage===2?country():region();
  projection.fitExtent([[42,24],[width-42,height-28]],base);
  const baseScale=projection.scale(),baseTranslate=projection.translate();
  const focus=state.stage===1?country():region(),point=projection(centerFor(focus));
  const factor=state.stage===3?1:1.15,scale=baseScale*factor;
  const targetTranslate=point?[width/2-(point[0]-baseTranslate[0])*factor,height/2-(point[1]-baseTranslate[1])*factor]:baseTranslate;
  const mix=state.stage===3?0:.68;
  viewTarget={scale,x:baseTranslate[0]*(1-mix)+targetTranslate[0]*mix,y:baseTranslate[1]*(1-mix)+targetTranslate[1]*mix,rotation:[0,0]};
 }
 projection.clipExtent([[0,0],[width,height]]);
 if(!camera||snap||reduced.matches||camera.globe!==(state.stage===0))camera={...viewTarget,rotation:[...viewTarget.rotation],globe:state.stage===0};
 dirty=true;
}
function syncCountries(){countries=continentCountries(world,continent().id);state.country=initialCountryIndex(countries,continent().id);regions=[];state.region=0;state.territory=0;}
function select(index){if(state.loading)return;const list=items();if(!list.length)return;state[['continent','country','region','territory'][state.stage]]=wrap(index,list.length);if(state.stage===0)syncCountries();holdUntil=performance.now()+6500;render();updateCamera();}
function move(direction){select(currentIndex()+direction);}
function backTo(stage){if(!world.length)return;loadId++;state.loading=false;$('map-loading').hidden=true;state.stage=Math.max(0,Math.min(stage,state.stage));holdUntil=performance.now()+4500;render();updateCamera();}
async function enter(){
 if(state.loading||!isEnabled())return;
 if(state.stage===0){state.stage=1;render();updateCamera();return;}
 if(state.stage===1){
  const token=++loadId,chosen=country();state.loading=true;renderLoading('Carregando regiões…');
  try{
   let data=regionCache.get(chosen.id);
   if(!data){
    if(chosen.properties.regionCount){const r=await fetch('/explorer/data/'+chosen.id+'.json');if(!r.ok)throw Error('Regiões indisponíveis');data=alphabetical((await r.json()).features.map(normalizeGeometry));}
    else data=[{...chosen,id:chosen.id+'-territory',properties:{...chosen.properties,name:'Território nacional',kind:'Territory'}}];
    regionCache.set(chosen.id,data);
   }
   if(token!==loadId)return;for(const r of data)if(r.id==='BR-SE')r.properties.areaGroupsFile='sergipe-pilot.json';regions=data;state.region=initialRegionIndex(regions,chosen.id);state.territory=0;state.stage=2;state.loading=false;$('map-loading').hidden=true;render();updateCamera();
  }catch{if(token!==loadId)return;state.loading=false;$('map-loading').hidden=true;render();$('selection-note').textContent='Não foi possível carregar as regiões. Tente novamente.';}
  return;
 }
 if(state.stage===2){
  const chosen=region(),token=++loadId;
  if(chosen.properties.areaGroupsFile&&!chosen.pilotLoaded){
   state.loading=true;renderLoading('Carregando áreas…');
   try{const response=await fetch('/explorer/data/'+chosen.properties.areaGroupsFile);if(!response.ok)throw Error('Áreas indisponíveis');const areas=await response.json();if(token!==loadId)return;registerMunicipalAreas(chosen,areas);chosen.pilotLoaded=true;}
   catch{if(token!==loadId)return;state.loading=false;$('map-loading').hidden=true;render();$('selection-note').lastChild.textContent=' Não foi possível carregar as áreas. Tente novamente.';return;}
  }
  state.loading=false;$('map-loading').hidden=true;state.stage=3;state.territory=0;render();updateCamera(true);return;
 }
 const areas=municipalAreas(region()),area=worldData.areas.find(a=>a.id===areas?.[state.territory]?.id);if(area)options.onArea(area.id);
}
function renderLoading(message){$('map-loading').hidden=false;$('map-loading').lastElementChild.textContent=message;$('explore').disabled=true;$('previous').disabled=true;$('next').disabled=true;}
function fact(value,label){const box=document.createElement('div');box.className='fact';const strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=value;span.textContent=label;box.append(strong,span);return box;}
function isEnabled(){return destinationEnabled(state.stage,{continent:continent()?.id,country:country()?.id,region:region()?.id});}
function render(){
 if(!world.length)return;
 if(state.stage===3)for(const group of municipalAreas(region())||[]){const a=worldData.areas.find(a=>a.id===group.id);group.properties.owner=a?.owner_id||null;group.properties.mine=!!a?.owner_id&&a.owner_id===worldData.player?.id;group.properties.battle=!!a?.battle_id;}
 const current=selected(),name=state.stage===0?current.name:current.properties.name;
 host.classList.toggle('map-flat',state.stage>0);
 host.dataset.stage=String(state.stage);$('hud-destinations').textContent=world.length;
 const tierControl=$('tier-control');tierControl.hidden=true;
 $('territory-details').hidden=state.stage!==3;$('troop-level').textContent='Tropas até nível '+({initial:3,middle:6,advanced:10}[state.tier]);
 $('heading').textContent=['MUNDO',continent().name.toUpperCase(),country()?.properties.name.toUpperCase(),region()?.properties.name.toUpperCase()][state.stage];
 $('eyebrow').textContent=['SEU PRÓXIMO DESTINO',continent().name.toUpperCase(),country()?.properties.name.toUpperCase(),region()?.properties.name.toUpperCase()][state.stage];
 $('context').textContent=['Escolha um continente e descubra o que vem a seguir.','Percorra os países com as setas ou toque no mapa.','Escolha um estado ou província para explorar.','Uma prévia das disputas que estão por vir.'][state.stage];
 $('selection-kind').textContent=['CONTINENTE SELECIONADO','PAÍS SELECIONADO','REGIÃO SELECIONADA','TERRITÓRIO SELECIONADO'][state.stage];
 $('selection-name').textContent=name;$('selection-icon').textContent=state.stage===0?'◉':state.stage===1?flag(country().properties.iso2):state.stage===2?'◈':'⚑';
 if(state.stage===0||state.stage===2){const outline=selectedFeature(),mini=geoMercator().fitExtent([[2,2],[45,44]],outline),path=geoPath(mini)(outline);$('selection-icon').innerHTML='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="'+path+'"/></svg>';}
 if(state.stage===3&&bases[1]?.complete&&bases[1].naturalWidth){const mini=document.createElement('canvas');mini.width=90;mini.height=96;mini.style.width='78px';mini.style.height='84px';mini.getContext('2d').drawImage(bases[1],0,0,180,192,0,0,90,96);$('selection-icon').replaceChildren(mini);const flag=document.createElement('span');flag.className='territory-flag';flag.innerHTML='<svg viewBox="0 0 40 46"><path d="M8 44V3" stroke="#dceef5" stroke-width="3"/><path d="M9 4c10-7 14 7 25 0v18c-11 7-15-7-25 0z" fill="#268ff8" stroke="#8edaff" stroke-width="1.4"/></svg>';$('selection-icon').append(flag);}
 $('selection-description').textContent=state.stage===0?continent().description:state.stage===1?`Explore ${country().properties.name} e descubra seus estados, províncias e regiões. O mapa acompanha cada escolha.`:state.stage===2?`Você está em ${region().properties.name}, ${country().properties.name}. Aproxime-se para visualizar os territórios desta região.`:`${name} faz parte de ${region().properties.name}. Este setor é uma prévia da futura expansão do mundo aberto.`;
 const facts=$('selection-facts');facts.replaceChildren();
 if(state.stage===0)facts.append(fact(countries.length,'países e territórios'),fact('6','continentes'));
 if(state.stage===1)facts.append(fact(country().properties.regionCount||1,'regiões para explorar'),fact(continent().name.replace('América do ','Am. '),'continente'));
 if(state.stage===2)facts.append(fact(territoryCount(region()),'áreas por população'),fact(flag(country().properties.iso2),country().properties.name));
 if(state.stage===3)facts.append(fact(tiers[state.tier].levels,'nível das tropas'),fact('CPU','defesa de exemplo'));
 $('explore').firstElementChild.textContent=['EXPLORAR CONTINENTE','EXPLORAR PAÍS','VER TERRITÓRIOS','CONQUISTAR'][state.stage];$('explore').disabled=state.loading||!isEnabled();if(!isEnabled())$('explore').firstElementChild.textContent='EM BREVE';
 const areaGroups=state.stage===3?municipalAreas(region()):null;
 const unitLabel=region()?.properties.administrativeUnitLabel||'municípios';
 const liveArea=state.stage===3?worldData.areas.find(a=>a.id===areaGroups?.[state.territory]?.id):null;
 if(liveArea){$('selection-name').textContent=liveArea.name;$('selection-description').textContent=liveArea.map_description||liveArea.description;$('explore').firstElementChild.textContent=liveArea.battle_id?'ACOMPANHAR BATALHA':'VER ÁREA';$('troop-level').textContent=liveArea.map_name||'Campo de batalha';$('territory-details').querySelector('.cpu-defense strong').textContent=liveArea.owner_name?'Comandante: '+liveArea.owner_name:'Guarnição CPU';}
 const note=state.stage===3?(areaGroups
  ?territoryCount(region())+' áreas · '+unitLabel+' neste grupo: '+areaGroups[state.territory].properties.municipalities.length+(region().properties.boundaryYear?' · divisas de '+region().properties.boundaryYear:'')+'.'
  :territoryCount(region())+' pontos de prévia · divisas locais pendentes'+(Number.isFinite(region().properties.population)?'.':' (população indisponível).'))
  :state.stage===2?(Number.isFinite(region().properties.population)?region().properties.population.toLocaleString('pt-BR')+' habitantes'+(region().properties.populationYear?' ('+region().properties.populationYear+')':'')+' · '+territoryCount(region())+' áreas.':'População indisponível · mínimo de 5 áreas.'):'Toque no mapa ou escolha na lista.';
 $('selection-note').lastChild.textContent=' '+(isEnabled()?note:'Em breve. Por enquanto, explore América do Sul → Brasil → Sergipe.');
 const divisionNotice=$('division-notice');
 const showDivisionNotice=state.stage===3&&!areaGroups;
 divisionNotice.hidden=!showDivisionNotice;
 divisionNotice.textContent=showDivisionNotice?'Divisas locais ainda não disponíveis para todas as áreas. Exibimos apenas pontos de prévia, sem criar fronteiras artificiais.' : '';

 $('back').disabled=state.stage===0;
 $('previous').disabled=state.loading;$('next').disabled=state.loading;
 $('previous').setAttribute('aria-label',labels[state.stage][0].toUpperCase()+labels[state.stage].slice(1)+' anterior');$('next').setAttribute('aria-label',(state.stage===2?'Próxima ':'Próximo ')+labels[state.stage]);
 $('position').replaceChildren();const positionStrong=document.createElement('strong');positionStrong.textContent=String(currentIndex()+1).padStart(2,'0');$('position').append(positionStrong,document.createTextNode(' / '+String(items().length).padStart(2,'0')));
 $('map-mode').textContent=state.stage===0?'GLOBO INTERATIVO':state.stage===3?'ÁREAS DO TERRITÓRIO':'MAPA PLANO · ZOOM DE SELEÇÃO';
 $('map').setAttribute('aria-label',`${state.stage===0?'Globo':state.stage===3?'Mapa de áreas':'Mapa'}: ${name}. Use as setas esquerda e direita para mudar a seleção.`);
 $('tier-control').hidden=true;
 root.querySelectorAll('[data-tier]').forEach(button=>{const active=button.dataset.tier===state.tier;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 $('spin').setAttribute('aria-label',state.paused?'Retomar rotação do globo':'Pausar rotação do globo');$('spin').setAttribute('aria-pressed',String(state.paused));$('spin').lastElementChild.textContent=state.paused?'Retomar rotação':'Pausar rotação';$('spin').firstElementChild.innerHTML=state.paused?'<path d="m9 5 10 7-10 7z"/>':'<path d="M8 6v12m8-12v12"/>';
 const crumbs=[{name:'Mundo',stage:0},...(state.stage>=1?[{name:continent().name,stage:1}]:[]),...(state.stage>=2?[{name:country().properties.name,stage:2}]:[]),...(state.stage>=3?[{name:region().properties.name,stage:3}]:[])];
 $('breadcrumbs').replaceChildren();for(const [i,crumb]of crumbs.entries()){if(i){const separator=document.createElement('span');separator.className='crumb-separator';separator.textContent='/';$('breadcrumbs').append(separator);}const button=document.createElement('button');button.textContent=crumb.name;button.addEventListener('click',()=>backTo(crumb.stage));if(i===crumbs.length-1)button.setAttribute('aria-current','location');$('breadcrumbs').append(button);}
 root.querySelectorAll('[data-step]').forEach(button=>{const index=Number(button.dataset.step);button.disabled=index>state.stage;button.classList.toggle('active',index===state.stage);if(index===state.stage)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
 $('announcement').textContent=name;dirty=true;
}
function shape(feature,fill,stroke,lineWidth=1,glow=false){ctx.beginPath();geoPath(projection,ctx)(feature);ctx.fillStyle=fill;if(glow){ctx.shadowBlur=9;ctx.shadowColor='#f4cb7380';}ctx.fill();ctx.shadowBlur=0;if(stroke){ctx.lineWidth=lineWidth;ctx.strokeStyle=stroke;ctx.stroke();}}
function drawBackground(){
 ctx.clearRect(0,0,width,height);
 if(state.stage!==0)return;
 ctx.fillStyle='#b0e3ec';for(let i=0;i<72;i++){const x=(Math.sin(i*127.1)*.5+.5)*width,y=(Math.sin(i*311.7+3)*.5+.5)*height;ctx.globalAlpha=.12+(i%4)*.06;ctx.beginPath();ctx.arc(x,y,i%3===0?.9:.55,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
}
function pin(point,label,number=null){
 if(!point||point.some(x=>!Number.isFinite(x))||point[0]<30||point[0]>width-30||point[1]<15||point[1]>height-20)return;
 const [x,y]=point;ctx.save();ctx.shadowBlur=15;ctx.shadowColor='#f3c56477';ctx.fillStyle='#f5d079';ctx.beginPath();ctx.arc(x,y-10,8,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(x-5,y-5);ctx.lineTo(x,y+4);ctx.lineTo(x+5,y-5);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#173043';ctx.beginPath();ctx.arc(x,y-10,3,0,Math.PI*2);ctx.fill();
 if(number!==null){ctx.fillStyle='#102b3d';ctx.strokeStyle='#f3c564';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y-13,14,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#ffe6a8';ctx.font='700 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(number,x,y-13);}
 if(label){ctx.font='600 13px system-ui';const w=ctx.measureText(label).width+22,left=Math.min(width-w-12,Math.max(12,x-w/2));ctx.fillStyle='#092237eb';ctx.strokeStyle='#40616c';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(left,y+13,w,29,6);ctx.fill();ctx.stroke();ctx.fillStyle='#e6f3f7';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,left+w/2,y+28);}
 ctx.restore();
}
function territoryPoints(){return territoryLocations(region());}
function baseMarker(point,index,label){
 if(!point)return;const [x,y]=point;if(x<20||x>width-20||y<20||y>height-15)return;
 const markerScale=Math.min(1,Math.max(.76,width/456));
 const active=index===state.territory,size=(active?57:49)*markerScale,owner=index===0||index===4?1:index===2||index===3?2:0,kind=[0,1,2,3,0][index],image=bases[owner];
 ctx.save();ctx.translate(x,y);ctx.shadowColor=active?'#fbe178':'#001a31';ctx.shadowBlur=active?13:4;ctx.beginPath();for(let i=0;i<6;i++){const a=(60*i-30)*Math.PI/180,px=Math.cos(a)*size*.6,py=Math.sin(a)*size*.33;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}ctx.closePath();ctx.fillStyle=owner===1?'#1f7fc8':owner===2?'#b63e3f':'#5f7874';ctx.fill();ctx.strokeStyle=active?'#ffe99b':'#e0eaf1';ctx.lineWidth=2;ctx.stroke();ctx.shadowBlur=0;
 if(image.complete&&image.naturalWidth)ctx.drawImage(image,(kind%8)*180,Math.floor(kind/8)*192,180,192,-size/2,-size*.88,size,size*192/180);
 else{ctx.fillStyle=owner===1?'#4fa4dc':'#b95c55';ctx.fillRect(-size*.25,-size*.6,size*.5,size*.6);}
 if(kind!==3){const flagX=-size*.08,flagY=-size*.91;ctx.strokeStyle='#e5edf0';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(flagX,flagY+size*.3);ctx.lineTo(flagX,flagY-size*.15);ctx.stroke();ctx.fillStyle=owner===1?'#2699ff':owner===2?'#fa4d3f':'#f2efce';ctx.beginPath();ctx.moveTo(flagX,flagY-size*.15);ctx.bezierCurveTo(flagX+size*.12,flagY-size*.23,flagX+size*.2,flagY-size*.03,flagX+size*.3,flagY-size*.11);ctx.lineTo(flagX+size*.3,flagY+size*.07);ctx.bezierCurveTo(flagX+size*.2,flagY+size*.15,flagX+size*.12,flagY-size*.05,flagX,flagY+size*.03);ctx.closePath();ctx.fill();}ctx.restore();
 if(label){ctx.save();ctx.font='700 13px system-ui';const boxWidth=Math.min(width-30,ctx.measureText(label).width+20),left=Math.max(10,Math.min(width-boxWidth-10,x-boxWidth/2));ctx.fillStyle='#051c36ee';ctx.strokeStyle='#f7d06b';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(left,y+23,boxWidth,27,5);ctx.fill();ctx.stroke();ctx.fillStyle='#fff8dc';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,left+boxWidth/2,y+36.5);ctx.restore();}
}
function draw(){
 if(!projection||!camera)return;
 projection.scale(camera.scale).translate([camera.x,camera.y]);if(state.stage===0)projection.rotate(camera.rotation);
 drawBackground();
 if(state.stage===3){stateMarkers=stateView.draw(ctx,{width,height,projection,feature:region(),contextFeatures:regions.filter(f=>f!==region()),locations:territoryPoints(),selected:state.territory,texture:terrain.draw(width,height,camera,projection.rotate(),false)});return;}
 const textured=terrain.draw(width,height,camera,projection.rotate(),state.stage===0);if(textured)ctx.drawImage(textured,0,0,width,height);
 if(state.stage===0){
  const ocean=ctx.createRadialGradient(camera.x-camera.scale*.45,camera.y-camera.scale*.5,5,camera.x,camera.y,camera.scale);ocean.addColorStop(0,'#247a9c');ocean.addColorStop(.65,'#154666');ocean.addColorStop(1,'#092a4a');ctx.save();ctx.shadowColor='#3cd4f6bb';ctx.shadowBlur=22;shape(globe,textured?'#0000':ocean,'#5dccf2',2);ctx.restore();
  if(!textured){ctx.beginPath();geoPath(projection,ctx)(graticule);ctx.strokeStyle='#89c7dc20';ctx.lineWidth=.65;ctx.stroke();}
 }else{
  ctx.save();ctx.strokeStyle='#7facbc0b';ctx.lineWidth=1;for(let x=width%32;x<width;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}for(let y=height%32;y<height;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}ctx.restore();
 }
 const selectedSet=new Set(state.stage===0?continentCountries(world,continent().id).map(f=>f.id):[]);
 const features=state.stage===0?world:state.stage===1?world:state.stage===2?regions:[region()];
 const land=ctx.createLinearGradient(0,0,width,height);land.addColorStop(0,'#41776b');land.addColorStop(.5,'#245e54');land.addColorStop(1,'#1a4746');
 const highlight=ctx.createLinearGradient(0,0,width,height);highlight.addColorStop(0,'#e8c275');highlight.addColorStop(.5,'#ab9557');highlight.addColorStop(1,'#56796a');
 for(const f of features){const isSelected=state.stage===0?selectedSet.has(f.id):state.stage===1?f.id===country().id:state.stage===2?f.id===region().id:true;const tint=state.stage===0?'#fbbf2526':state.stage===3?'#75bd2915':'#7cfa1a18';shape(f,textured?(isSelected?tint:'#0000'):(isSelected?highlight:land),isSelected?(state.stage===0?'#ffda61':'#eeffcc'):(textured?'#b5e4e24a':'#729e9a60'),isSelected?1.7:.7,isSelected);}
 if(state.stage===0){
  if(!textured){const shadow=ctx.createRadialGradient(camera.x-camera.scale*.35,camera.y-camera.scale*.4,camera.scale*.2,camera.x+camera.scale*.2,camera.y+camera.scale*.15,camera.scale*1.1);shadow.addColorStop(0,'#0000');shadow.addColorStop(.6,'#03172a06');shadow.addColorStop(1,'#020d23c0');shape(globe,shadow,null);}
  const anchor=continent().anchor,center=[-camera.rotation[0],-camera.rotation[1]];if(geoDistance(anchor,center)<Math.PI*.43)pin(projection(anchor),'');
 }else pin(projection(centerFor(state.stage===1?country():region())),(state.stage===1?country():region()).properties.name);
}
function frame(now){
 if(host.dataset.disposed==='true')return;requestAnimationFrame(frame);const dt=Math.min(70,now-lastFrame||16);lastFrame=now;if(document.hidden||!host.isConnected||!world.length||!width||!height)return;
 if(state.stage===0&&!state.paused&&!state.loading&&now>holdUntil){viewTarget.rotation[0]+=dt*.0022;dirty=true;}
 let moving=false;if(camera&&viewTarget){const ease=reduced.matches?1:Math.min(1,dt/110);for(const key of ['scale','x','y']){const difference=viewTarget[key]-camera[key];if(Math.abs(difference)>.02){camera[key]+=difference*ease;moving=true;}else camera[key]=viewTarget[key];}if(state.stage===0)for(let axis=0;axis<2;axis++){let difference=viewTarget.rotation[axis]-camera.rotation[axis];if(axis===0)difference=((difference+180)%360+360)%360-180;if(Math.abs(difference)>.005){camera.rotation[axis]+=difference*ease;moving=true;}}}
 if((dirty||moving)&&now-lastPaint>32){draw();lastPaint=now;dirty=false;}
}
function resize(){const r=viewport.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,1.7);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);updateCamera(true);}
function renderPicker(){const query=$('search').value.trim().toLocaleLowerCase('pt-BR'),list=items();$('picker-items').replaceChildren();for(const [index,item]of list.entries()){if(!item.properties.name.toLocaleLowerCase('pt-BR').includes(query))continue;const button=document.createElement('button');button.className='picker-item'+(index===currentIndex()?' active':'');const name=document.createElement('span'),detail=document.createElement('small');name.textContent=item.properties.name;const enabled=destinationEnabled(state.stage,{continent:state.stage===0?item.id:continent().id,country:state.stage===1?item.id:country()?.id,region:state.stage===2?item.id:region()?.id});detail.textContent=!enabled?'Em breve':index===currentIndex()?'Selecionado':'Disponível';button.classList.toggle('coming-soon',!enabled);button.append(name,detail);button.addEventListener('click',()=>{select(index);$('picker').close();$('open-picker').setAttribute('aria-expanded','false');});$('picker-items').append(button);}if(!$('picker-items').children.length){const p=document.createElement('p');p.className='empty-search';p.textContent='Nenhum destino encontrado.';$('picker-items').append(p);}}
$('previous').addEventListener('click',()=>move(-1));$('next').addEventListener('click',()=>move(1));$('explore').addEventListener('click',enter);$('back').addEventListener('click',()=>backTo(state.stage-1));
$('spin').addEventListener('click',()=>{state.paused=!state.paused;holdUntil=performance.now();render();});$('reset-camera').addEventListener('click',()=>{holdUntil=performance.now()+5000;updateCamera();});
$('open-picker').addEventListener('click',()=>{if(state.loading)return;$('picker-title').textContent=['Escolha um continente','Escolha um país','Escolha uma região','Escolha um território'][state.stage];$('search').value='';renderPicker();$('picker').showModal();$('open-picker').setAttribute('aria-expanded','true');$('search').focus();});$('close-picker').addEventListener('click',()=>$('picker').close());$('picker').addEventListener('close',()=>$('open-picker').setAttribute('aria-expanded','false'));$('search').addEventListener('input',renderPicker);
$('about').addEventListener('click',()=>$('about-dialog').showModal());$('close-about').addEventListener('click',()=>$('about-dialog').close());$('close-conquest').addEventListener('click',()=>$('conquest-dialog').close());
for(const dialog of root.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
root.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>backTo(Number(button.dataset.step))));root.querySelectorAll('[data-tier]').forEach(button=>button.addEventListener('click',()=>{state.tier=button.dataset.tier;render();}));
root.addEventListener('keydown',event=>{if(root.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}if(event.key==='ArrowRight'){event.preventDefault();move(1);}if(event.key==='Escape'&&state.stage>0)backTo(state.stage-1);});
canvas.addEventListener('pointerdown',event=>{dragStart={x:event.clientX,y:event.clientY};holdUntil=performance.now()+7000;});canvas.addEventListener('pointercancel',()=>dragStart=null);
canvas.addEventListener('pointerup',event=>{if(!dragStart||state.loading)return;const dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;dragStart=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3){move(dx>0?-1:1);return;}if(Math.abs(dx)>8||Math.abs(dy)>8||!projection)return;const rect=canvas.getBoundingClientRect(),point=[event.clientX-rect.left,event.clientY-rect.top];if(state.stage===0&&Math.hypot(point[0]-camera.x,point[1]-camera.y)>camera.scale)return;if(state.stage===3){const groups=municipalAreas(region());if(groups){const location=projection.invert(point),hit=location?groups.findIndex(f=>geoContains(f,location)):-1;if(hit>=0)select(hit);return;}if(!stateMarkers.length)return;let closest=0;for(let i=1;i<stateMarkers.length;i++)if(Math.hypot(stateMarkers[i][0]-point[0],stateMarkers[i][1]-point[1])<Math.hypot(stateMarkers[closest][0]-point[0],stateMarkers[closest][1]-point[1]))closest=i;select(closest);return;}const location=projection.invert(point);if(!location)return;if(state.stage===0){const hit=world.find(f=>geoContains(f,location));if(hit){const index=CONTINENTS.findIndex(c=>c.id===hit.properties.continent||(c.id==='Oceania'&&hit.properties.continent==='Seven seas (open ocean)'));if(index>=0)select(index);}}else if(state.stage===1||state.stage===2){const list=state.stage===1?countries:regions;const index=list.findIndex(f=>geoContains(f,location));if(index>=0)select(index);}else{const points=territoryPoints().map(p=>projection(p));let closest=0;for(let i=1;i<points.length;i++)if(Math.hypot(points[i][0]-point[0],points[i][1]-point[1])<Math.hypot(points[closest][0]-point[0],points[closest][1]-point[1]))closest=i;select(closest);}});
reduced.addEventListener('change',()=>{if(reduced.matches)state.paused=true;render();updateCamera(true);});const visible=()=>{lastFrame=performance.now();dirty=true;};document.addEventListener('visibilitychange',visible);const observer=new ResizeObserver(resize);observer.observe(viewport);
async function initialize(){try{const response=await fetch('/explorer/data/world.json');if(!response.ok)throw Error('Map unavailable');world=(await response.json()).features.map(normalizeGeometry);syncCountries();state.loading=false;const saved=options.saved;if(saved){if(saved.stage===0){state.continent=saved.continent;syncCountries();}else{state.stage=1;if(saved.stage>=2){await enter();if(saved.stage>=3)await enter();}Object.assign(state,{continent:saved.continent,country:saved.country,region:saved.region,territory:saved.territory});}}$('map-loading').hidden=true;render();resize();}catch{$('map-loading').lastElementChild.textContent='Não foi possível carregar o mapa.';const retry=document.createElement('button');retry.className='quiet-button';retry.textContent='Tentar novamente';retry.addEventListener('click',()=>{retry.remove();initialize();});$('map-loading').append(retry);}}
initialize();requestAnimationFrame(frame);
return {snapshot(){return {...state,loading:false};},update(next){worldData=next;if(!state.loading)render();},selectArea(id){const index=region()?municipalAreas(region())?.findIndex(a=>a.id===id):-1;if(state.stage===3&&index>=0)select(index);},goSergipe(){if(state.stage===3)return;},dispose(){host.dataset.disposed='true';observer.disconnect();document.removeEventListener('visibilitychange',visible);}};
}
window.DOMINATION_EXPLORER={create:createExplorer};
