import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {playEconomyMatch} from './ai/economy-evaluate.mjs';
import {summary} from './ai/evaluate.mjs';
const [phase,candidate,opponent,firstText,countText,output]=process.argv.slice(2);
const protocol=JSON.parse(await readFile(new URL('../artifacts/ai/economy/confirmation/protocol.json',import.meta.url),'utf8')),settings=protocol[phase];
assert.ok(settings?.pairs.some(([a,b])=>a===candidate&&b===opponent),'Unregistered phase/pair');
const firstSeed=Number(firstText),seeds=Number(countText);assert.ok(Number.isInteger(firstSeed)&&Number.isInteger(seeds)&&seeds>0&&firstSeed>=settings.firstSeed&&firstSeed+seeds<=settings.firstSeed+settings.seeds&&output);
const repoRoot=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8',cwd:fileURLToPath(new URL('../..',import.meta.url))}).trim();
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',cwd:repoRoot});
const sourcePaths=['xingbei-cli/src','xingbei-cli/tools','xingbei-cli/test','xingbei-cli/artifacts/ai/economy/confirmation/protocol.json'];
const checkFrozen=()=>{assert.equal(git('diff','HEAD','--',...sourcePaths),'','Source/protocol must be frozen');assert.equal(git('ls-files','--others','--exclude-standard','--',...sourcePaths),'','Runtime/tools/tests/protocol must be tracked');};
const commit=git('rev-parse','HEAD').trim();checkFrozen();
const rosters={mirrorAssault:['berserker','berserker','windSwordmaster','windSwordmaster','marksman','marksman'],mirrorMixed:['sealer','sealer','guardianAngel','guardianAngel','priest','priest'],asymmetric:['berserker','priest','sealer','marksman','guardianAngel','windSwordmaster'],asymmetricReverse:['priest','berserker','marksman','sealer','windSwordmaster','guardianAngel']};
const results=[],started=Date.now();
for(let seed=firstSeed;seed<firstSeed+seeds;seed++){
 for(const lineup of settings.rosters)for(const start of settings.starts)for(const team of settings.colors){const base=rosters[lineup],heroIds=team==='red'?base:[base[1],base[0],base[3],base[2],base[5],base[4]];
  results.push(await playEconomyMatch({lineup,heroIds,seed,start,team},{candidate,opponent,turnLimit:protocol.turnLimit}));
 }
 console.log(JSON.stringify({candidate,opponent,seed,completed:results.length,seconds:(Date.now()-started)/1000}));
}
assert.equal(git('rev-parse','HEAD').trim(),commit);checkFrozen();
const report={commit,sourceUnchanged:true,settings:{phase,candidate,opponent,firstSeed,seeds,turnLimit:protocol.turnLimit},summary:summary(results),results};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
