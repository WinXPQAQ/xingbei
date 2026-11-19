export default function capabilities(c) {
  const judgment=Math.min(4,(c.hs.judgment??0)+Number(Boolean(c.hs.form)));
  return {
    spellThreats:[c.threat('finalJudgment',judgment,Number(judgment>0))],
    discard:{self:c.energyReady*c.count},
    turnover:{draw:c.energyReady*Math.max(0,c.p.limit-c.count)},
    notes:['审判形态的回合开始增加审判；判决天平清手与补牌互斥，清手会失去整套应战牌。'],
  };
}
