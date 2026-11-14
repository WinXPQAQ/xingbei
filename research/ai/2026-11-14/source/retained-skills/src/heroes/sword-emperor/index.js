import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, targets } from '../shared/actions.js';
import { coveredCards } from '../shared/covered.js';
export class SwordEmperor extends Hero {
  constructor(enabled = true) {
    super({ id: 'swordEmperor', name: '剑帝' }); this.state = { swordQi: 0 };
    if (!enabled) return; const hero = this;
    this.skills = [
      { id: 'soulGuard', name: '剑魂守护', ...this.onOwnAttack([Timing.ATTACK_MISS]), priority: 1,
        filter: ({ player, context }) => this.isActiveAttack(context) && !context.swordSoul && context.card.location?.zone === 'field' && coveredCards(player, 'swordSoul').length < 3,
        resolve({ game, player, context }) { game.logSkill(player.id, 'soulGuard', '未命中的攻击牌成为剑魂'); game.coverCards(player.id, [context.card], 'swordSoul'); } },
      { id: 'feint', name: '佯攻', ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ context }) => this.isActiveAttack(context),
        resolve: ({ game, player }) => hero.addQi(game, player, 1, 'feint') },
      { id: 'swordQiSlash', name: '剑气斩', ...this.onOwnAttack([Timing.ATTACK_HIT]), priority: -20,
        filter: ({ context }) => this.isActiveAttack(context) && hero.state.swordQi > 0,
        *resolve({ game, player, context, options }) {
          const amount = yield* choice(player.id, 'swordQiSlash', '剑气斩：选择消耗剑气数量', Array.from({ length: Math.min(3, hero.state.swordQi) + 1 }, (_, value) => ({ value, label: value ? `${value}剑气` : '不发动' })), 0, context);
          if (!amount) return;
          const targetId = yield* game.choosePlayer(player.id, targets(game).filter(id => id !== context.targetId), '剑气斩：选择攻击目标以外的角色', { skillId: 'swordQiSlash', context: { amount } });
          hero.state.swordQi -= amount; game.logSkill(player.id, 'swordQiSlash', `移除${amount}剑气，对${game.actorLabel(targetId)}造成${amount}法伤`);
          yield* game.damageSteps(targetId, amount, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'swordQiSlash' });
        } },
      ...[['angelSoul','天使之魂',1],['demonSoul','恶魔之魂',0]].map(([id,name,parity])=>({
        id,name,...this.onOwnAttack([Timing.ATTACK_DECLARED,Timing.ATTACK_HIT,Timing.ATTACK_MISS]), priority: -21,
        filter: ({ player, timing, context }) => this.isActiveAttack(context) && (timing === Timing.ATTACK_DECLARED ?
          player.energy.gem + player.energy.crystal > 0 && (player.energy.gem + player.energy.crystal) % 2 === parity && coveredCards(player,'swordSoul').length > 0 : context.swordSoul === id),
        *resolve({ game, player, timing, context }) {
          if (timing === Timing.ATTACK_DECLARED) {
            const card = yield* game.chooseCoveredCard(player.id,'swordSoul',{skillId:id,title:`${name}：可移除1张剑魂`,optional:true});
            if (!card) return; game.discardCovered(player.id,card,{skillId:id}); context.swordSoul=id;
            if (id==='demonSoul') context.amount++;
          } else if (id==='angelSoul') {
            if (timing===Timing.ATTACK_HIT) game.changeHealing(player.id,2);
            else game.changeMorale(player.team,1);
            game.logSkill(player.id,id,timing===Timing.ATTACK_HIT?'命中，获得2治疗':'未命中，我方士气+1');
          } else if (timing===Timing.ATTACK_MISS) hero.addQi(game,player,2,id);
        },
      })),
      { id:'unyielding',name:'不屈意志',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),priority:-30,
        filter:({game,player})=>game.canPayEnergy(player.id,'crystal'),
        *resolve({game,player,options}) {
          if (!(yield* game.offerSkill(player.id,'unyielding','不屈意志：消耗1水晶，摸1张、+1剑气并获得额外攻击'))) return;
          yield* game.paySkillEnergy(player.id,'crystal');
          yield* game.drawSteps(player.id,1,{...options,cause:{type:'directDraw',skillId:'unyielding'}});
          hero.addQi(game,player,1,'unyielding'); game.turn.addAttackAction({sourceSkillId:'unyielding'});
        } },
    ];
  }
  addQi(game,player,count,skillId) { const before=this.state.swordQi; this.state.swordQi=Math.min(5,before+count); game.logSkill(player.id,skillId,`剑气+${this.state.swordQi-before}（${this.state.swordQi}/5）`); }
}
