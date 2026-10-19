// Diagnostic only: previously used seeds, baseline trajectories, no policy tuning.
import {writeFile} from 'node:fs/promises';
import {Game} from '../../../src/engine.js';
import {getPolicy} from '../../../src/ai/versions.js';
import {playMatch,lineups} from '../../../tools/ai/evaluate.mjs';
const baseline=getPolicy('v1.0'),legacy=getPolicy('heroes-1');
const stats={games:0,executedActions:0,changedTopAction:0,byHero:{}};
const original=Game.prototype.executeAction;
Game.prototype.executeAction=function(id,action,options) {
 const hero=this.player(id).hero.id,s=stats.byHero[hero]??={executedActions:0,changedTopAction:0};
 stats.executedActions++;s.executedActions++;
 const a=baseline.chooseAiAction(this,id),b=legacy.chooseAiAction(this,id);
 if(JSON.stringify(a)!==JSON.stringify(b)){stats.changedTopAction++;s.changedTopAction++;}
 return original.call(this,id,action,options);
};
try {for(const lineup of Object.keys(lineups))for(let seed=1;seed<=3;seed++)for(const start of [0,1]){await playMatch({lineup,seed,start,team:'red'},{candidate:'v1.0',opponent:'v1.0'});stats.games++;}}
finally {Game.prototype.executeAction=original;}
const report={scope:'36 baseline trajectories, reused tune seeds 1–3, starts 0/1; compare top action before executed actions, excludes pass; not new win-rate evidence',...stats};
await writeFile(new URL('./legacy-decision-diagnostic.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
