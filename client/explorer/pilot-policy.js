export function destinationEnabled(stage,{continent,country,region}={}){
 return continent==='South America'&&(stage===0||country==='BRA'&&(stage===1||region==='BR-SE'));
}
export const PILOT_PATH='Mundo → América do Sul → Brasil → Sergipe';
