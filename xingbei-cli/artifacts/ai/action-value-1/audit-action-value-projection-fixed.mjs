import fs from 'node:fs';import assert from 'node:assert/strict';
import {Game} from '/workspace/xingbei-wind-economy/xingbei-cli/src/engine.js';
import {captureObservation,observationView} from '/workspace/xingbei-wind-economy/xingbei-cli/src/ai/observation.js';
import {stateOf,clone,handValue} from '/workspace/xingbei-wind-economy/xingbei-cli/src/ai/action-value1/model.js';
const g=new Game({heroIds:['windSwordmaster','none','none','none','none','none']});g.startTurn(0);const s=stateOf(observationView(captureObservation(g,0,{actions:true})),0);s.players[0].count=1;
const off=clone(s);off.tempo=false;let ordinaryDelta=handValue(s,s.players[0])-handValue(off,off.players[0]);
const t=clone(s);t.prior={size:2,counts:Object.fromEntries(Object.keys(t.prior.counts).map(k=>[k,0]))};Object.assign(t.prior.counts,{attack:1,slow:1,fire:1,poison:1});const off2=clone(t);off2.tempo=false;const syntheticDelta=handValue(t,t.players[0])-handValue(off2,off2.players[0]);
assert(Math.abs(syntheticDelta)<1e-10);assert(Math.abs(ordinaryDelta)<1e-10);const out={ordinaryOneUnknownCardDelta:ordinaryDelta,twoCardPoolOneUnknownCardDelta:syntheticDelta,trueBacklogForEveryPossibleOneCardHand:0,scope:'No known cards and exactly one unknown; every completion has at most one ordinary action. Tempo-only difference must be zero.'};fs.writeFileSync('/tmp/audit-action-value-projection-fixed.json',JSON.stringify(out,null,2));console.log(out);
