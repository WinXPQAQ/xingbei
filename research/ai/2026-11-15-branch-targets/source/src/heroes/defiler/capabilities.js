export default function capabilities(c) {
  const raging=Boolean(c.hs.form), malice=c.hs.malice??0;
  const bonus=Number(raging), pollution=raging&&malice>0?1:0;
  const amountByTarget=base=>Object.fromEntries(c.enemies.map(target=>[target.id,base+bonus+Number(target.healing>0)+pollution]));
  return {
    basicMagic:false,
    spellThreats:[
      c.threat('magicBullet',2,c.playChance({name:'magicBullet'}),{targets:c.relayTargets.slice(0,1),shieldable:true,responseKind:'magic',amountByTarget:amountByTarget(2),noHealing:pollution>0}),
      c.threat('poison',1,c.playChance({name:'poison'})*.3,{amountByTarget:amountByTarget(1),delayed:true,noHealing:pollution>0}),
    ],
    discard:{self:c.gemReady*(c.count>2?2:0)},
    turnover:{draw:c.gemReady*2},
    normalPlay:c.attack+Number(!raging&&malice<2&&!c.hs.surgeUsed)*c.chance({type:'attack'},2),
    notes:['狂戾和目标治疗提高法伤；神智污染禁疗需要戾气，未来中毒结算时形态仍有不确定性。'],
  };
}
