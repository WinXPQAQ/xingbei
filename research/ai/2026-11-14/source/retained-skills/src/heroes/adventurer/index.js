import { Hero } from '../../hero-base.js';
import { AttackCard } from '../../card.js';
import { sameElements } from '../../card-sets.js';
import { attackSteps } from '../../resolution/attack.js';
import { discardCost, extraAction } from '../shared/actions.js';
const elements = ['water', 'fire', 'wind', 'thunder', 'earth', 'dark'];
export class Adventurer extends Hero {
  constructor(enabled = true) {
    super({ id: 'adventurer', name: '冒险家' });
    if (!enabled) return;
    this.skills = [
      { id: 'deception', name: '欺诈',
        action(game, player, action = {}) {
          const mode = action.mode ?? 'water'; if (!elements.includes(mode)) return null;
          return { type: 'attack', cardCount: mode === 'dark' ? 3 : 2,
            cardsFilter: cards => sameElements(game, player.id, cards),
            targets: game.players.filter(p => game.canAttackTarget(player.id, p.id)).map(p => p.id),
            modes: elements.map(value => ({ value, label: `${value === 'dark' ? '3' : '2'}张同系牌→${{water:'水',fire:'火',wind:'风',thunder:'雷',earth:'地',dark:'暗'}[value]}系攻击` })) };
        },
        *resolveAction({ game, player, cards, targetIds, action, options }) {
          yield* discardCost(game, player, cards, 'deception', options);
          game.gainEnergy(player.id, 'crystal'); game.logSkill(player.id, 'strongFortune', '发动欺诈，获得1水晶');
          // A virtual attack is a rule description, not a new physical card.
          const element = action.mode ?? 'water';
          const attack = { id: null, name: `${element}Strike`, type: 'attack', uniqueSkills: [],
            getTraits: () => ({ elements: [element], fates: [] }), hasUniqueSkill: () => false,
            canRespond: AttackCard.prototype.canRespond };
          yield* attackSteps(game, player.id, -1, targetIds[0], { ...options, virtualAttack: attack });
        } },
      { id: 'strongFortune', name: '强运' }, { id: 'undergroundLaw', name: '地下法则' },
      { id: 'adventurerParadise', name: '冒险者天堂',
        action(game, player, action = {}) {
          const available = game.stoneCounts(player.team), modes = [];
          for (let gem = 0; gem <= 2; gem++) for (let crystal = 0; crystal <= 2 - gem; crystal++)
            if (gem + crystal && gem <= available.gem && crystal <= available.crystal) modes.push({ value: `${gem}:${crystal}`, label: `交给队友${gem}宝石、${crystal}水晶` });
          const chosen = modes.find(m => m.value === action.mode) ?? (!action.mode ? modes[0] : null);
          if (!chosen) return null;
          const [gem, crystal] = chosen.value.split(':').map(Number);
          return { type: 'special', modes, targets: game.players.filter(p => p.team === player.team && p.id !== player.id &&
            game.getEnergyLimit(p.id) - p.energy.gem - p.energy.crystal >= gem + crystal).map(p => p.id) };
        },
        *resolveAction({ game, player, targetIds, action }) {
          const spec = player.hero.skills.find(s => s.id === 'adventurerParadise').action(game, player, action);
          const [gem, crystal] = (action.mode ?? spec.modes[0].value).split(':').map(Number);
          game.removeStones(player.team, { gem, crystal });
          game.gainEnergy(targetIds[0], 'gem', gem); game.gainEnergy(targetIds[0], 'crystal', crystal);
          if (player.energy.gem + player.energy.crystal > 0) yield* game.paySkillEnergy(player.id, 'crystal');
          game.logSkill(player.id, 'adventurerParadise', `提炼${gem}宝石、${crystal}水晶并交给${game.actorLabel(targetIds[0])}，有能量时移除自身1能量`);
        } },
      { id: 'sleightOfHand', name: '偷天换日',
        action(game, player, action = {}) {
          if (game.turn.state?.usedSkills.sleightOfHand) return null;
          const enemy = player.team === 'red' ? 'blue' : 'red';
          const modes = [{ value: 'convert', label: '己方战绩水晶全部转为宝石' },
            ...(game.stoneCounts(enemy).gem ? [{ value: 'steal', label: '转移对方1战绩宝石到己方' }] : [])];
          if (action.mode && !modes.some(m => m.value === action.mode)) return null;
          return { type: 'spell', energy: 'crystal', targetCount: 0, targets: [], modes };
        },
        *resolveAction({ game, player, action }) {
          yield* game.paySkillEnergy(player.id, 'crystal');
          if (game.turn.state) game.turn.state.usedSkills.sleightOfHand = true;
          if (action.mode === 'steal') {
            game.removeStones(player.team === 'red' ? 'blue' : 'red', { gem: 1, crystal: 0 }); game.addStones(player.team, 'gem');
          } else {
            const count = game.stoneCounts(player.team).crystal;
            if (count) { game.removeStones(player.team, { gem: 0, crystal: count }); game.addStones(player.team, 'gem', count); }
          }
          game.logSkill(player.id, 'sleightOfHand', action.mode === 'steal' ? '转移对方1战绩宝石' : '己方战绩水晶转为宝石');
          yield* extraAction(game, player, 'sleightOfHand');
        } },
    ];
  }
  purchaseStones() { return this.skills.length ? { gem: 2, crystal: 0 } : { gem: 1, crystal: 1 }; }
}
