// Whitelist only fields used by policy decisions. No title, logs, raw engine,
// presentation snapshots, arbitrary request properties or hidden card objects.
export function requestData(r,v) {
 const out={};
 for(const key of ['type','playerId','skillId','purpose','recipientId','targetId','count','optional','defaultValue','shieldable','isCounter','damage','reservedEnergy','reservedHealing','energy','choices'])if(r[key]!==undefined)out[key]=structuredClone(r[key]);
 for(const key of ['target','actor','player','nextTarget'])if(r[key])out[key]=r[key].id;
 if(r.counterTargets)out.counterTargets=r.counterTargets.map(p=>p.id);
 if(r.valid)out.valid=r.valid.map(e=>typeof e==='number'?e:{index:e.index,cardId:v.cards.has(e.card.id)?e.card.id:null});
 if(r.context)out.context={targetId:r.context.targetId,amount:r.context.amount,damageType:r.context.damageType,cardId:v.cards.has(r.context.card?.id)?r.context.card.id:null};
 if(r.attack)out.attackId=v.cards.has(r.attack.id)?r.attack.id:null;
 return JSON.parse(JSON.stringify(out));
}
export function requestFromData(data,v) {
 const out=structuredClone(data);
 for(const key of ['target','actor','player','nextTarget'])if(out[key]!=null)out[key]=v.player(out[key]);
 if(out.counterTargets)out.counterTargets=out.counterTargets.map(id=>v.player(id));
 if(out.valid)out.valid=out.valid.map(e=>typeof e==='number'?e:{index:e.index,card:v.cards.get(e.cardId)});
 if(out.context)out.context={...out.context,card:v.cards.get(out.context.cardId)};
 if(out.attackId)out.attack=v.cards.get(out.attackId);
 return out;
}
