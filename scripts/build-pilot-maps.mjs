import fs from 'node:fs';import {createFieldWorld} from './pilot/field-world.mjs';import {balancedField} from './pilot/balanced-field.mjs';
const areas=JSON.parse(fs.readFileSync('public/explorer/data/sergipe-pilot.json')).features;
const models=[['ilhas','vertical'],['frentes','horizontal'],['passagem','vertical'],['anel','misto'],['corredor','horizontal'],['dispersas','misto'],['ilhas','horizontal'],['frentes','misto'],['passagem','misto'],['anel','vertical']];
const result=areas.map((area,index)=>{
 const [modelId,directionId]=models[index],world=createFieldWorld({modelId,directionId,sizeId:index>5?'medio':'compacto',seed:'sergipe-pilot-v1-'+area.id});
 const axis=directionId==='horizontal'||directionId==='misto'&&['frentes','anel'].includes(modelId)?'x':'y';
 let center;
 if(modelId==='anel'){const middle=world.tiles.filter(t=>t.island===(directionId==='misto'?0:1)&&t.row===(directionId==='misto'?9:4));center={x:(Math.min(...middle.map(t=>t.x))+Math.max(...middle.map(t=>t.x)))/2,y:middle[0].y};}
 const balanced=balancedField(world,{axis,center});console.log(area.id,balanced.audit);
 return {id:'se-pilot-'+String(index+1).padStart(2,'0')+'-v2',area:area.id,name:world.model.name+' · '+world.direction.name,tag:world.direction.name.toUpperCase(),description:world.model.description+' Posições opostas equilibradas, com os mesmos apoios e distâncias de expansão. Campo próprio de '+area.properties.name+'.',width:balanced.width,height:balanced.height,hexAngle:world.hexAngle,scroll:true,side:directionId==='horizontal'?2.1:directionId==='misto'?1.9:1.4,overflow:directionId==='horizontal'?1.45:1.7,data:balanced.data};
});
fs.writeFileSync('shared/pilot-maps.json',JSON.stringify(result));console.log('Built',result.length,'balanced versioned live layouts');
