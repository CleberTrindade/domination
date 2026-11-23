'use strict';
const {Pool}=require('pg');
const {previewReset,resetBattles}=require('../server/maintenance/reset-battles');
async function main(){
 const args=process.argv.slice(2),execute=args.includes('--confirm'),onlyAccounts=args.includes('--only-accounts');
 if(!process.env.DATABASE_URL)throw Error('Configure DATABASE_URL para a branch Neon mundo-aberto.');
 if(process.env.APP_ENV!=='mundo-aberto')throw Error('APP_ENV deve ser mundo-aberto. Não executar contra outro ambiente.');
 if(execute&&(args[args.indexOf('--confirm')+1]!=='reset de batalha'||!args.includes('--service-stopped')))throw Error('Pare o serviço antes e use --service-stopped --confirm "reset de batalha".');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 try{const target=new URL(process.env.DATABASE_URL);console.log('Destino:',target.hostname+target.pathname);console.log('Antes:',await previewReset(pool));
  if(!execute){console.log('Prévia: nenhum dado alterado. Pare o serviço antes de executar o reset.');return;}
  console.log('Reset concluído:',await resetBattles(pool,{onlyAccounts}));console.log(onlyAccounts?'Cadastros e acessos preservados; avaliações, amizades e progresso removidos. Reative o serviço.':'Contas, amizades e enquetes preservadas. Reative o serviço.');
 }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
