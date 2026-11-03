import { heroFields } from './hero-state.mjs';
import { createHero, HERO_DEFINITIONS } from '../../src/hero.js';
export const HERO_IDS = Object.keys(HERO_DEFINITIONS).sort();
// Every twelve games covers all 72 heroes. Rotate seats before reshuffling.
export function roster(index) {
  const block = Math.floor(index / 12), epoch = Math.floor(block / 6);
  let state = (71103 + epoch) >>> 0;
  const ids = [...HERO_IDS];
  for (let i = ids.length-1; i > 0; i--) {
    state = (Math.imul(state, 1664525)+1013904223) >>> 0;
    const j = state % (i+1); [ids[i],ids[j]] = [ids[j],ids[i]];
  }
  const group = ids.slice((index % 12)*6, (index % 12)*6+6);
  return group.map((_,seat) => group[(seat+block%6)%6]);
}
if (process.argv[1]?.endsWith('rosters.mjs')) console.log(JSON.stringify({ heroes:HERO_IDS, vocabularySymbols:[...new Set(HERO_IDS.flatMap(id=>[`hero=${id}`, ...createHero(id).getSkills().map(skill=>`skill=${skill.id}`), ...Object.keys(heroFields[id]).map(field=>`field=${field}`)]))], rosters:Array.from({length:2400},(_,i)=>roster(i)) }));
