// Small preregistered diagnostic league. No candidate tuning or promotion claim.
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {schedule,playMatch,summary,lineups} from './ai/evaluate.mjs';
const [candidate,opponent,output]=process.argv.slice(2);
if(!['v1.0','v1.2'].includes(candidate)||!['v1.0','v1.1','defense-1','all-1'].includes(opponent)||!output)throw Error('Usage candidate opponent output');
const settings={candidate,opponent,seeds:6,firstSeed:50001,selected:Object.keys(lineups),turnLimit:500};
const results=[];for(const config of schedule(settings))results.push(await playMatch(config,settings));
const report={purpose:'diagnostic only; 6 seed clusters, no strength/promotion claim',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),settings,summary:summary(results),byLineup:Object.fromEntries(Object.keys(lineups).map(id=>[id,summary(results.filter(r=>r.lineup===id))])),results};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(candidate,opponent,report.summary.games,report.summary.scoreRate,report.summary.clusterBootstrap95);
