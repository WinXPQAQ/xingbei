import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { playableCards } from '../../playable-cards.js';
import { choice, targets, discardCost } from '../shared/actions.js';
import { discardHand } from '../shared/covered.js';
const sameFate=(game,p,cards)=>cards.length>0&&cards[0].getTraits({game,playerId:p.id}).fates.some(f=>cards.every(c=>c.getTraits({game,playerId:p.id}).fates.includes(f)));
const allies=(game,p)=>game.players.filter(t=>t.team===p.team&&t.id!==p.id).map(t=>t.id);
export class YinYangMaster extends Hero {
  constructor(enabled=true){
    super({id:'yinYangMaster',name:'阴阳师'});this.state={form:null,ghostFire:0};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'shikigamiConvert',name:'式神转换'},

      {id:'shikigamiDescent',name:'式神降临',
        action:(game,p)=>!hero.state.form?{type:'spell',cardCount:2,cardsFilter:cs=>sameFate(game,p,cs),targetCount:0}:null,
        *resolveAction({game,player,cards,options}){yield* discardCost(game,player,cards,'shikigamiDescent',options);hero.state.form='shikigami';hero.gain(game,player,1,'shikigamiDescent');game.turn.addAttackAction({sourceSkillId:'shikigamiDescent'});}},
      {id:'yinYangConvert',name:'阴阳转换',...this.onOwnAttack([Timing.ATTACK_DECLARED]),priority:200,
        filter:({context})=>hero.isCounterAttack(context)&&context.previousAttackTraits?.fates.some(f=>context.attackTraits.fates.includes(f)),
        *resolve({game,player,context,options}){
          if(!context.requiresCounterSkill&&!(yield* game.offerSkill(player.id,'yinYangConvert','阴阳转换：增加鬼火，式神形态重置并改变伤害')))return;
          hero.gain(game,player,1,'yinYangConvert');
          if(yield* game.offerSkill(player.id,'shikigamiConvert','式神转换：强制摸1张，鬼火+1')){yield* game.drawSteps(player.id,1,{...options,cause:{type:'directDraw',skillId:'shikigamiConvert'}});hero.gain(game,player,1,'shikigamiConvert');}
          if(hero.state.form){hero.state.form=null;context.amount=hero.state.ghostFire;game.logSkill(player.id,'yinYangConvert',`重置式神形态，应战伤害变为${context.amount}`);}
        }},
      {id:'darkRitual',name:'黑暗祭礼',...this.onOwnTurn([Timing.TURN_END]),
        filter:()=>hero.state.ghostFire===3,
        *resolve({game,player,options}){hero.state.ghostFire=0;const id=yield* game.choosePlayer(player.id,targets(game),'黑暗祭礼：移除全部鬼火，选择2法伤目标',{skillId:'darkRitual'});yield* game.damageSteps(id,2,{...options,sourceId:player.id,damageType:'spell',skillId:'darkRitual'});}},
      {id:'shikigamiBinding',name:'式神咒束',...this.bind('target',[Timing.ATTACK_RESPONSE_BEFORE],'team'),priority:-100,
        filter:({game,player,context})=>hero.isActiveAttack(context)&&context.targetId!==player.id&&context.canCounter&&!context.forcedHit&&hero.state.form&&game.stoneCounts(player.team).gem>=1&&game.stoneCounts(player.team).total>=2&&!context.boundResponse,
        *resolve({game,player,context}){
          const counterTargets=game.players.filter(p=>game.canAttackTarget(player.id,p.id,true)&&p.id!==context.actorId);
          const valid=playableCards(player).map((card,index)=>({card,index})).filter(({card})=>card.type==='attack'&&game.canRespond(context.card,card,{actorId:context.actorId,targetId:player.id,attackTraits:context.attackTraits}));
          if(!valid.length||!counterTargets.length)return;
          const response=yield {type:'response',skillId:'shikigamiBinding',protectedTargetId:context.targetId,title:`式神咒束：${game.actorLabel(context.targetId)}受到${game.actorLabel(context.actorId)}攻击，可代替队友应战`,actor:game.player(context.actorId),target:player,attack:context.card,attackTraits:context.attackTraits,valid,counterTargets,damage:context.amount,shieldable:context.shieldable,isCounter:false};
          if(!response)return;
          if(!valid.some(e=>e.index===response.index)||!counterTargets.some(p=>p.id===response.targetId))throw new Error('式神咒束应战选择无效');
          const counts=game.stoneCounts(player.team);let cost={gem:1,crystal:1};
          if(counts.gem>=2&&counts.crystal){const type=yield* choice(player.id,'shikigamiStones','式神咒束：支付战绩星石',[{value:'mixed',label:'1宝石1水晶'},{value:'gems',label:'2宝石'}],'mixed');if(type==='gems')cost={gem:2,crystal:0};}
          else if(!counts.crystal)cost={gem:2,crystal:0};
          game.removeStones(player.team,cost);context.targetId=player.id;context.boundResponse=response;
          game.logSkill(player.id,'shikigamiBinding',`消耗${cost.gem}宝石${cost.crystal}水晶，代替队友承接攻击并应战`);
        }},
      {id:'lifeBarrier',name:'生命结界',
        action(game,p,action={}){
          const modes=[{value:'support',label:'队友+1宝石、+1治疗，自受鬼火数法伤'}];if(hero.state.form)modes.push({value:'reset',label:'明弃同命格2牌，重置，队友弃1牌'});
          if(action.mode&&!modes.some(m=>m.value===action.mode))return null;
          return {type:'spell',energy:'crystal',modes,cardCount:action.mode==='reset'?2:0,cardsFilter:cs=>action.mode!=='reset'||sameFate(game,p,cs),targets:allies(game,p)};
        },
        *resolveAction({game,player,cards,targetIds,action,options}){
          yield* game.paySkillEnergy(player.id,'crystal');hero.gain(game,player,1,'lifeBarrier');
          if(action.mode==='reset'){yield* discardCost(game,player,cards,'lifeBarrier',options);hero.state.form=null;yield* discardHand(game,targetIds[0],1,'lifeBarrier',options);}
          else {game.gainEnergy(targetIds[0],'gem');game.changeHealing(targetIds[0],1);yield* game.damageSteps(player.id,hero.state.ghostFire,{...options,sourceId:player.id,damageType:'spell',skillId:'lifeBarrier',moraleLoss:hero.state.ghostFire!==3});}
        }},
    ];
  }
  canRespond({game,player,card,attackTraits}){return !!this.skills.length&&card.type==='attack'&&attackTraits.fates.some(f=>card.getTraits({game,playerId:player.id}).fates.includes(f));}
  gain(game,p,n,skillId){const before=this.state.ghostFire;this.state.ghostFire=Math.min(3,before+n);game.logSkill(p.id,skillId,`鬼火+${this.state.ghostFire-before}（${this.state.ghostFire}/3）`);}
}
