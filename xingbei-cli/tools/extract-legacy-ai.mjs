// Read-only extraction of static AI metadata, not old engine execution.
// Original source is GPL-3.0; provenance and hash travel with the generated file.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createHero, HERO_DEFINITIONS } from '../src/hero.js';
const root = path.resolve(process.argv[2] ?? '../xingbei-1.6.7-source');
const output = path.resolve(process.argv[3] ?? 'training/legacy/static-orders.json');
const packs = ['shiZhouNian','yiDuanYeHuo','zhongMoDaoZhu','shenZiChuangLin','teDian'];
const normalize = s => String(s ?? '').replace(/<[^>]*>|\[[^\]]*\]|【[^】]*】|\s/g,'');
const entries = [], sources = {};
for (const pack of packs) {
  const file = `character/${pack}.js`, body = fs.readFileSync(path.join(root,file),'utf8');
  sources[file] = createHash('sha256').update(body).digest('hex');
  const game = { import(_kind, factory) { const data = factory({},game,{}, {}, {}, {});
    for (const [id,skill] of Object.entries(data.skill ?? {})) {
      const name = normalize(data.translate?.[id]);
      if (name) entries.push({name,id,file,order:typeof skill.ai?.order==='number'?skill.ai.order:null,
        dynamic:typeof skill.ai?.order==='function'});
    }
  }};
  const context = vm.createContext({game,lib:{},ui:{},get:{},ai:{},_status:{}});
  vm.runInContext(body.replace(/^import .*?;\s*$/mg,''),context,{timeout:2000,filename:file});
}
const heroes = {};
for (const id of Object.keys(HERO_DEFINITIONS)) {
  heroes[id] = {};
  for (const skill of createHero(id).getSkills()) {
    const matches = entries.filter(e=>e.name===normalize(skill.name));
    const staticMatches=matches.filter(e=>e.order!==null);
    const orders=[...new Set(staticMatches.map(e=>e.order))];
    if(orders.length===1) heroes[id][skill.id]={order:orders[0],sources:staticMatches.map(({id,file})=>({id,file}))};
  }
}
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({schema:1,license:'GPL-3.0; original xingbei-1.6.7-source/LICENSE',
  scope:'Only unambiguous numeric ai.order; dynamic order and embedded callbacks are NOT migrated',sources,heroes},null,2)+'\n');
console.log(JSON.stringify({heroes:Object.values(heroes).filter(x=>Object.keys(x).length).length,skills:Object.values(heroes).reduce((n,x)=>n+Object.keys(x).length,0),output}));
