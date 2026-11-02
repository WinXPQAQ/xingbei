import { Hero } from '../../hero-base.js';
import { ExclusiveCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { choice, targets, enemies } from '../shared/actions.js';
import { seatOrder, discardHand } from '../shared/covered.js';
export class BloodSwordSpirit extends Hero {
  constructor(enabled = true) {
    super({id:'bloodSwordSpirit',name:'血色剑灵'}); this.state={blood:0,gardenCardId:null};
    if (!enabled) return;
    const hero=this;
    this.skills=[
      {id:'bloodThorns',name:'血色荆棘',...this.onOwnAttack([Timing.ATTACK_HIT]),priority:-25,
        resolve({game,player}) { hero.addBlood(game,player,1,3,'bloodThorns'); }},
      {id:'scarletFlash',name:'赤色一闪',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),priority:-30,
        filter:()=>hero.state.blood>0,
        *resolve({game,player,options}) {
          if (!(yield* game.offerSkill(player.id,'scarletFlash','赤色一闪：移除1鲜血，自受2法伤，额外攻击'))) return;
          hero.state.blood--;
          yield* game.damageSteps(player.id,2,{...options,sourceId:player.id,damageType:'spell',skillId:'scarletFlash'});
          game.turn.addAttackAction({sourceSkillId:'scarletFlash'});
        }},
      {id:'bloodRose',name:'血染蔷薇',
        action:game=>hero.state.blood>=2?{type:'spell',targets:targets(game)}:null,
        *resolveAction({game,player,targetIds,options}) {
          hero.state.blood-=2; game.changeHealing(targetIds[0],-2);
          const allies=game.players.filter(p=>p.team===player.team&&p.energy.crystal>0).map(p=>p.id);
          if(allies.length) {
            const id=yield* game.choosePlayer(player.id,allies,'血染蔷薇：将我方1水晶翻面为宝石',{skillId:'bloodRoseEnergy'});
            game.player(id).energy.crystal--; game.gainEnergy(id,'gem',1);
          }
          if (hero.gardenActive(game)) for(const id of seatOrder(game,player.id)) yield* game.damageSteps(id,1,{...options,sourceId:player.id,damageType:'spell',skillId:'bloodRose'});
        }},
      {id:'bloodBarrier',name:'血气屏障',...this.onDamage([Timing.DAMAGE_BEFORE],'target',['spell']),priority:-10,
        filter:({context})=>hero.state.blood>0&&context.sourceId!=null,
        *resolve({game,player,context,options}) {
          if(!(yield* game.offerSkill(player.id,'bloodBarrier','血气屏障：移除1鲜血，法伤−1并反击',context))) return;
          hero.state.blood--;context.amount=Math.max(0,context.amount-1);
          const targetId=yield* game.choosePlayer(player.id,enemies(game,player),'血气屏障：选择法伤目标',{skillId:'bloodBarrier'});
          yield* game.damageSteps(targetId,1,{...options,sourceId:player.id,damageType:'spell',skillId:'bloodBarrier'});
        }},
      {id:'roseGarden',name:'血蔷薇庭院',...this.bind('target',[Timing.HEALING_BEFORE],'all'),priority:100,
        filter:({game})=>hero.gardenActive(game), resolve:({context})=>{context.healingLimit=0;}},
      {id:'gardenEnd',name:'血蔷薇庭院结束',...this.onOwnTurn([Timing.TURN_END]),
        filter:({game})=>hero.gardenActive(game),
        resolve({game,player}) {game.moveCard(hero.state.gardenCardId,{zone:'outside'});game.logSkill(player.id,'roseGarden','回合结束，庭院返回场外');}},
      {id:'petalDance',name:'散华轮舞',...this.onOwnTurn([Timing.ACTIVATION]),
        filter:({game,player})=>game.canPayEnergy(player.id,'crystal'),
        *resolve({game,player,options}) {
          const choices=[{value:'skip',label:'不发动'},{value:'crystal',label:'水晶：放置庭院，+2鲜血'}];
          if(game.canPayEnergy(player.id,'gem'))choices.push({value:'gem',label:'宝石：放置庭院，+2鲜血（最高4），弃到4张'});
          const kind=yield* choice(player.id,'petalDance','散华轮舞',choices,'skip');
          if(kind==='skip')return;
          yield* game.paySkillEnergy(player.id,kind);
          game.moveCard(hero.state.gardenCardId,{zone:'field'},{reason:'roseGarden'});
          hero.addBlood(game,player,2,kind==='gem'?4:3,'petalDance');
          if(kind==='gem')yield* discardHand(game,player.id,Math.max(0,player.hand.length-4),'petalDance',options);
        }},
    ];
  }
  initialize(game,player) {
    if(!this.skills.length)return;
    const card=new ExclusiveCard({id:`roseGarden:${player.id}`,name:'roseGarden'});
    game.registerCard(card,{zone:'outside'});this.state.gardenCardId=card.id;
  }
  gardenActive(game){return game.cards.get(this.state.gardenCardId)?.location.zone==='field';}
  addBlood(game,player,n,cap,skillId){const before=this.state.blood;this.state.blood+=Math.max(0,Math.min(n,cap-before));game.logSkill(player.id,skillId,`鲜血+${this.state.blood-before}（${this.state.blood}）`);}
}
