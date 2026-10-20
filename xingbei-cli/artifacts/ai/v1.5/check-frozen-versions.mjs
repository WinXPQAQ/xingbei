import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import fs from 'node:fs';
const oldDirectories=['src/ai/v1.0','src/ai/v1.1','src/ai/v1.3','src/ai/v1.3-economy4','src/ai/targeted-fixes1','deploy'];assert.equal(execFileSync('git',['diff','146b52f','--',...oldDirectories],{encoding:'utf8'}),'');
for(const file of fs.readdirSync('src/ai/v1.5-plans1'))assert.equal(fs.readFileSync(`src/ai/v1.5-plans1/${file}`,'utf8'),execFileSync('git',['show',`0a3c5c1:xingbei-cli/src/ai/v1.5-candidate/${file}`],{encoding:'utf8'}));
assert.match(fs.readFileSync('src/ai.js','utf8'),/AI_POLICY_VERSION = "v1.4"/);console.log('Frozen stable directories and rejected plans-1 unchanged; production remains v1.4.');
