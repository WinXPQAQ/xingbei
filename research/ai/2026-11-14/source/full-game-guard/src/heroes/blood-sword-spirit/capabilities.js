export default function capabilities(c) {
  const blood=c.hs.blood??0;
  const garden=c.p.healingDisabled&&Boolean(c.hs.gardenCardId);
  return {
    spellThreats:[
      c.threat('bloodBarrier',1,Number(blood>0)*.4,{route:'spellDamageResponse'}),
      c.threat('bloodRose',1,Number(garden&&blood>=2),{
        targeting:'allPlayers',targets:c.state.players.map(p=>p.id),targetCount:c.state.players.length,
      }),
    ],
    discard:{self:c.gemReady*Math.max(0,c.count-4)},
    turnover:{selfDamageDraw:blood>0?c.attack*2:0},
    normalPlay:c.attack*(blood>0?1.5:1),
    notes:['鲜血允许赤色一闪续刀，也可能支付屏障；两者共用鲜血，不能全部累加。庭院蔷薇会同时伤害队友。'],
  };
}
