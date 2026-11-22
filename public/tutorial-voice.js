'use strict';
/* Fixed Portuguese male recordings. Never selects an installed browser voice. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createTutorialVoice=factory;})(typeof window==='object'?window:this,function({AudioClass,clips=[],onChange=()=>{}}={}){
 const urls=new Map(clips.map(clip=>[clip.text,'/audio/tutorial/'+clip.file]));
 const supported=typeof AudioClass==='function'&&urls.size>0;
 let enabled=false,speaking=false,text='',generation=0,error='',audio=null;
 const state=()=>({supported,enabled,speaking,error});
 const changed=()=>onChange(state());
 function silence(){generation++;speaking=false;if(audio){audio.onended=null;audio.onerror=null;audio.onplaying=null;audio.pause();try{audio.currentTime=0;}catch{}}changed();}
 function play(){
  silence();if(!enabled||!text||!supported)return;error='';const url=urls.get(text),id=generation;
  if(!url){enabled=false;error='Áudio desta etapa indisponível. Continue pelo texto.';changed();return;}
  if(!audio){audio=new AudioClass();audio.preload='auto';}
  audio.src=url;
  const failed=()=>{if(id!==generation)return;enabled=false;speaking=false;error='Não foi possível carregar o áudio. Confira a conexão e toque em Ouvir.';changed();};
  audio.onended=()=>{if(id!==generation)return;speaking=false;changed();};audio.onerror=failed;
  audio.onplaying=()=>{if(id!==generation)return;speaking=true;changed();};
  try{const pending=audio.play();pending?.catch(failed);}catch{failed();}
 }
 return {state,silence,setText(value){if(value===text)return;text=value;silence();if(enabled)play();},toggle(){if(!supported)return;enabled=!enabled;if(enabled)play();else{error='';silence();}},repeat(){if(!supported)return;enabled=true;play();},clear(){text='';error='';silence();}};
});
