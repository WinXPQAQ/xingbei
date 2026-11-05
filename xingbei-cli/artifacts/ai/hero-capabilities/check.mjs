import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { HERO_DEFINITIONS } from '../../../src/hero.js';
import { createDeck } from '../../../src/cards.js';
import { estimateHeroCapabilities, CAPABILITY_HERO_IDS, capabilityCoverage } from '../../../src/ai/hero-capabilities.js';
import { capabilityContext } from '../../../src/heroes/shared/ai/capabilities.js';

assert.deepEqual(Object.keys(HERO_DEFINITIONS).sort(), [...CAPABILITY_HERO_IDS].sort());
const deck = createDeck().map(c => ({ id:c.id, name:c.name, type:c.type, elements:c.getTraits().elements, fates:c.getTraits().fates, uniqueSkills:c.uniqueSkills }));
const state = { observer:0, teams:{red:{morale:6},blue:{morale:8}}, players:Array.from({length:6}, (_,id) => ({
  id, team:[0,3,4].includes(id)?'red':'blue', hero:'redLotusKnight', count:6, limit:6, healing:2,
  energy:{gem:1,crystal:1}, heroState:{bloodSeals:1}, hand:id===0?deck.slice(0,6):[], known:[], effects:[], coveredCount:2, skillIds:[],
})) };
let checked=0;
for (const hero of CAPABILITY_HERO_IDS) for (const count of [0,1,6,12]) for (const target of [0,1]) {
  Object.assign(state.players[target], { hero, count, hand:target===0?deck.slice(30,30+count):[], heroState:{}, energy:{gem:count?1:0,crystal:count?1:0} });
  const output=estimateHeroCapabilities(state,target), before=JSON.stringify(output);
  if (target!==state.observer) {
    state.players[target].hand=deck.slice(80,80+count);
    state.players[target].heroState.prophecyFace='flameGale';
    state.deck=deck.toReversed();
    assert.equal(JSON.stringify(estimateHeroCapabilities(state,target)),before,hero);
  }
  function finiteTree(x) { if(typeof x==='number') assert(Number.isFinite(x),hero); else if(x&&typeof x==='object') Object.values(x).forEach(finiteTree); }
  finiteTree(output);
  assert(output.spellThreats.every(t=>t.readiness>=0&&t.readiness<=1));
  checked++;
}
const reserve={...deck.find(c=>c.name==='magicBullet'),reserve:true};
Object.assign(state.players[0],{hero:'elfArcher',count:1,hand:[reserve,deck[0]],known:[]});
const context=capabilityContext(state,state.players[0]);
assert.equal(context.known.length,1);
assert.equal(context.known[0].id,deck[0].id);
assert.equal(context.unknown,0);
assert.equal(context.chance({name:'magicBullet'}),0);
assert.equal(context.playChance({name:'magicBullet'}),1);
assert.equal(estimateHeroCapabilities(state,0).flow.outgoing,1);

const report={generatedAt:new Date().toISOString(),status:'passed',genericStateCombinations:checked,coverage:Object.fromEntries(['modeled','baseline-only'].map(kind=>[kind,Object.values(capabilityCoverage).filter(x=>x===kind).length])),checks:['registered hero IDs','finite outputs','readiness range','hidden hand/deck/prophecy invariance','reserve cards separate from hand capacity'],limitations:['not hero policy or win-rate validation','partial capability profiles','static printed-deck priors']};
writeFileSync(new URL('./report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
