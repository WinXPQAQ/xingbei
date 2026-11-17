// Read-only extraction from the original game's character packs. Never run skills.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const original=path.resolve(process.argv[2]??'../xingbei-1.6.7-source/character');
const packs=['shiZhouNian','poXiao','shenZiChuangLin','teDian','zhongMoDaoZhu','yiDuanYeHuo'];
const output={source:original,packs:[],errors:[]};
const loaded=[];
for(const name of packs){
 try{
  const text=fs.readFileSync(path.join(original,name+'.js'),'utf8').replace(/^import .*?;\s*/,'');
  let pack;
  const empty={config:{poXiao_gai_initialized_0714:true}};const game={import(type,factory){pack=factory(empty,game,empty,empty,empty,empty);}};
  vm.runInNewContext(text,{game,lib:empty,ui:empty,get:empty,ai:empty,_status:empty},{timeout:2000});
  if(!pack?.character)throw Error('Missing character definitions');
  loaded.push({name,pack,sha256:createHash('sha256').update(fs.readFileSync(path.join(original,name+'.js'))).digest('hex')});
 }catch(error){output.errors.push({pack:name,error:error.message});}
}
const plain=s=>String(s??'').replace(/<\/?(?:span|b|i|font|br|div|p|strong|em)(?:\s[^>]*)?\/?>/gi,'').replace(/\s+/g,' ').trim();
for(const {name,pack,sha256} of loaded){
 const translated=key=>pack.translate?.[key]??loaded.find(item=>item.pack.translate?.[key]!=null)?.pack.translate[key];
 const heroes=Object.entries(pack.character).map(([sourceId,data])=>({sourceId,name:plain(translated(sourceId)),skills:data[3].map(id=>{
  const provider=pack.skill?.[id]?{name,pack}:loaded.find(item=>item.pack.skill?.[id]);
  const skill=provider?.pack.skill?.[id]??{};
  const code=Object.values(skill).filter(v=>typeof v==='function').map(String).join('\n');
  const inherited=skill.inherit?loaded.find(item=>item.pack.translate?.[skill.inherit+'_info']):null;
  const intro=typeof skill.intro?.content==='string'?skill.intro.content:null;
  const description=plain(translated(id+'_info')??intro??inherited?.pack.translate[skill.inherit+'_info']);
  const descriptionSource=translated(id+'_info')!=null?'translation':intro?'intro':inherited?'inherited':null;
  return {sourceId:id,definitionPack:provider?.name??null,name:plain(translated(id)),description,descriptionSource,inherit:skill.inherit??null,trigger:skill.trigger??null,
   storageFields:[...new Set([...code.matchAll(/\.storage\.([\w]+)/g)].map(m=>m[1]))],
   capabilities:['盖牌','指示物','横置','重置','额外','转移','附加','展示','手牌上限','治疗','伤害'].filter(term=>description.includes(term))};
 })}));
 output.packs.push({name,sha256,heroes});
}
output.heroEntries=output.packs.reduce((n,p)=>n+p.heroes.length,0);
output.skillEntries=output.packs.reduce((n,p)=>n+p.heroes.reduce((n,h)=>n+h.skills.length,0),0);
output.uniqueNames=[...new Set(output.packs.flatMap(p=>p.heroes.map(h=>h.name)))];
console.log(JSON.stringify(output,null,2));
if(output.errors.length)process.exitCode=1;
