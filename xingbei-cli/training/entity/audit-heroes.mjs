// Read-only extraction from the original game's character packs. Never run skills.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const original=path.resolve(process.argv[2]??'../xingbei-1.6.7-source/character');
const packs=['shiZhouNian','poXiao','shenZiChuangLin','teDian','zhongMoDaoZhu','yiDuanYeHuo'];
const output={source:original,packs:[],errors:[]};
for(const name of packs){
 try{
  const text=fs.readFileSync(path.join(original,name+'.js'),'utf8').replace(/^import .*?;\s*/,'');
  let pack;
  const empty={config:{poXiao_gai_initialized_0714:true}};const game={import(type,factory){pack=factory(empty,game,empty,empty,empty,empty);}};
  vm.runInNewContext(text,{game,lib:empty,ui:empty,get:empty,ai:empty,_status:empty},{timeout:2000});
  if(!pack?.character)throw Error('Missing character definitions');
  const plain=s=>String(s??'').replace(/<\/?(?:span|b|i|font|br|div|p|strong|em)(?:\s[^>]*)?\/?>/gi,'').replace(/\s+/g,' ').trim();
  const heroes=Object.entries(pack.character).map(([sourceId,data])=>({sourceId,name:plain(pack.translate?.[sourceId]),skills:data[3].map(id=>{
   const skill=pack.skill?.[id]??{};
   const code=Object.values(skill).filter(v=>typeof v==='function').map(String).join('\n');
   return {sourceId:id,name:plain(pack.translate?.[id]),description:plain(pack.translate?.[id+'_info']),trigger:skill.trigger??null,
    storageFields:[...new Set([...code.matchAll(/\.storage\.([\w]+)/g)].map(m=>m[1]))],
    capabilities:['盖牌','指示物','横置','重置','额外','转移','附加','展示','手牌上限','治疗','伤害'].filter(term=>plain(pack.translate?.[id+'_info']).includes(term))};
  })}));
  output.packs.push({name,heroes});
 }catch(error){output.errors.push({pack:name,error:error.message});}
}
output.heroEntries=output.packs.reduce((n,p)=>n+p.heroes.length,0);
output.uniqueNames=[...new Set(output.packs.flatMap(p=>p.heroes.map(h=>h.name)))];
console.log(JSON.stringify(output,null,2));
if(output.errors.length)process.exitCode=1;
