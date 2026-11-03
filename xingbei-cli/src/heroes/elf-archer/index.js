import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, targets, discardCost, healTarget } from '../shared/actions.js';
import { coveredCards, discardHand } from '../shared/covered.js';
export class ElfArcher extends Hero {
  constructor(enabled=true){
    super({id:'elfArcher',name:'精灵射手'});this.state={form:null,elementShotUsed:false,windArrowPending:false};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'waterArrow',name:'水之矢'},
      {id:'earthArrow',name:'地之矢'},
      {id:'petEnhancement',name:'宠物强化'},

      {id:'elementShotReset',name:'元素射击重置',...this.bind('player',[Timing.TURN_BEFORE],'all'),
        resolve(){hero.state.elementShotUsed=false;hero.state.windArrowPending=false;}},
      {id:'elementShot',name:'元素射击',...this.onOwnAttack([Timing.ATTACK_DECLARED,Timing.ATTACK_HIT]),
        filter:({timing,context})=>hero.isActiveAttack(context)&&(timing===Timing.ATTACK_DECLARED?!hero.state.elementShotUsed&&!context.attackTraits.elements.includes('dark'):!!context.elementArrow),
        *resolve({game,player,timing,context,options}){
          if(timing===Timing.ATTACK_HIT){
            if(context.elementArrow==='water')yield* healTarget(game,player,1,'waterArrow');
            if(context.elementArrow==='earth'){
              const id=yield* game.choosePlayer(player.id,targets(game),'地之矢：选择1法伤目标',{skillId:'earthArrow'});
              yield* game.damageSteps(id,1,{...options,sourceId:player.id,damageType:'spell',skillId:'earthArrow'});
            }return;
          }
          const choices=[{value:'skip',label:'不发动'}];
          if(player.hand.some(c=>c.type==='spell'))choices.push({value:'spell',label:'明弃1张法术牌'});
          if(coveredCards(player,'blessing').length)choices.push({value:'blessing',label:'移除1张祝福'});
          if(choices.length===1)return;
          const cost=yield* choice(player.id,'elementShot','元素射击',choices,'skip',context);if(cost==='skip')return;
          if(cost==='spell'){const cards=yield* game.chooseHandCards(player.id,1,c=>c.type==='spell',{skillId:'elementShotCost'});yield* discardCost(game,player,cards,'elementShot',options);}
          else {const card=yield* game.chooseCoveredCard(player.id,'blessing',{skillId:'elementShotBlessing'});game.discardCovered(player.id,card,{skillId:'elementShot'});}
          hero.state.elementShotUsed=true;
          const elements=context.attackTraits.elements.filter(e=>e!=='dark');
          const element=elements.length===1?elements[0]:yield* choice(player.id,'elementArrow','选择元素箭效果',elements.map(value=>({value,label:value})),elements[0]);
          context.elementArrow=element;
          if(element==='fire')context.amount++;
          if(element==='thunder')context.canCounter=false;
          if(element==='wind')hero.state.windArrowPending=true;
          game.logSkill(player.id,'elementShot',`发动${({fire:'火之矢，攻击+1',water:'水之矢，命中后治疗',wind:'风之矢，行动结束后额外攻击',thunder:'雷之矢，无法应战',earth:'地之矢，命中后1法伤'})[element]}`);
        }},
      {id:'windArrow',name:'风之矢',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter:()=>hero.state.windArrowPending,resolve({game}){hero.state.windArrowPending=false;game.turn.addAttackAction({sourceSkillId:'windArrow'});}},
      {id:'animalCompanion',name:'动物伙伴',...this.onDamage([Timing.DAMAGE_AFTER],'actor'),
        filter:({game,player,context})=>game.turn.state?.playerId===player.id&&context.actual>0,
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'animalCompanion','动物伙伴：摸1张再弃1张')))return;
          let targetId=player.id;
          if(game.canPayEnergy(player.id,'crystal')&&(yield* game.offerSkill(player.id,'petEnhancement','宠物强化：花1水晶，将摸弃改为目标角色'))){
            yield* game.paySkillEnergy(player.id,'crystal');targetId=yield* game.choosePlayer(player.id,targets(game),'宠物强化：选择摸弃角色',{skillId:'petEnhancement'});
          }
          yield* game.drawSteps(targetId,1,{...options,cause:{type:'directDraw',skillId:'animalCompanion'}});
          yield* discardHand(game,targetId,1,'animalCompanion',options);
        }},
      {id:'elfRitual',name:'精灵秘仪',...this.onOwnTurn([Timing.ACTIVATION]),
        filter:({game,player})=>!hero.state.form&&game.canPayEnergy(player.id,'gem'),
        *resolve({game,player}){if(!(yield* game.offerSkill(player.id,'elfRitual','精灵秘仪：1宝石，获得3祝福')))return;yield* game.paySkillEnergy(player.id,'gem');hero.state.form='elfBlessing';game.coverDeck(player.id,3,'blessing');}},
      {id:'elfRitualEnd',name:'精灵秘仪结束',...this.onOwnTurn([Timing.TURN_END]),
        filter:({player})=>hero.state.form&&!coveredCards(player,'blessing').length,
        *resolve({game,player,options}){hero.state.form=null;const id=yield* game.choosePlayer(player.id,targets(game),'精灵秘仪：祝福耗尽，选择2法伤目标',{skillId:'elfRitualEnd'});yield* game.damageSteps(id,2,{...options,sourceId:player.id,damageType:'spell',skillId:'elfRitualEnd'});}},
    ];
  }
  *refreshCovered(game,player,options){
    const cards=coveredCards(player,'blessing');
    for(const card of cards)game.discardCovered(player.id,card,{reveal:true,skillId:'elfRitual'});
    game.coverDeck(player.id,cards.length,'blessing');
  }
}
