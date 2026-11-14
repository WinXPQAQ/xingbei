import { AI_POLICY_VERSION } from '../../src/ai.js';
import { heroFields } from './hero-state.mjs';
import { createHero, HERO_DEFINITIONS } from '../../src/hero.js';
export const ALL_HERO_IDS = Object.keys(HERO_DEFINITIONS).sort();
export const EXCLUDED_TRAINING_HERO_IDS = ['magicArcherEX'];
export const HERO_IDS = ALL_HERO_IDS.filter(id=>!EXCLUDED_TRAINING_HERO_IDS.includes(id));
// A cyclic deck gives each of the 71 training heroes each seat once per 71
// games, without duplicates within a game. Reshuffle only after the full cycle.
export function roster(index) {
  const epoch = Math.floor(index / HERO_IDS.length), offset=(index%HERO_IDS.length)*6;
  let state = (71103 + epoch) >>> 0;
  const ids = [...HERO_IDS];
  for (let i = ids.length-1; i > 0; i--) {
    state = (Math.imul(state, 1664525)+1013904223) >>> 0;
    const j = state % (i+1); [ids[i],ids[j]] = [ids[j],ids[i]];
  }
  return Array.from({length:6},(_,seat)=>ids[(offset+seat)%ids.length]);
}
if (process.argv[1]?.endsWith('rosters.mjs')) console.log(JSON.stringify({ heroes:HERO_IDS, ruleTeacher:AI_POLICY_VERSION, registeredHeroes:ALL_HERO_IDS, excludedTrainingHeroes:EXCLUDED_TRAINING_HERO_IDS, vocabularySymbols:[...new Set(ALL_HERO_IDS.flatMap(id=>[`hero=${id}`, ...createHero(id).getSkills().map(skill=>`skill=${skill.id}`), ...Object.keys(heroFields[id]).map(field=>`field=${field}`)]))], rosters:Array.from({length:2400},(_,i)=>roster(i)) }));
