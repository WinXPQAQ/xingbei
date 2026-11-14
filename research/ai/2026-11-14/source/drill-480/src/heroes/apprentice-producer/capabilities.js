import elementalist from '../elementalist/capabilities.js';
export default function capabilities(c) {
  const result = elementalist(c);
  result.spellThreats = result.spellThreats.filter(t => t.skillId !== 'elementIgnition');
  result.turnover = { exchange: c.hs.atoms >= 2 ? Math.min(3, c.count) : 0 };
  result.notes = ['继承元素独有技与月陨；元子重塑为等量换牌，不视为净减压。'];
  return result;
}
