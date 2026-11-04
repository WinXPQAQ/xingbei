import { Hero } from '../../hero-base.js';
import { AttackCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { attackSteps } from '../../resolution/attack.js';
import { choice, targets, enemies, hasElement } from '../shared/actions.js';
import { coveredCards, seatOrder, discardHand, trimCovered } from '../shared/covered.js';
const darkAttack={id:null,name:'darkStrike',type:'attack',uniqueSkills:[],getTraits:()=>({elements:['dark'],fates:[]}),hasUniqueSkill:()=>false,canRespond:AttackCard.prototype.canRespond};
export class MagicArcher extends Hero {
  constructor(enabled=true){
    super({id:'magicArcher',name:'魔弓'});this.state={charged:false,pierceUsed:false,multiShotUsed:false,lastTarget:null};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'chargeTurnReset',name:'魔弓回合重置',...this.onOwnTurn([Timing.TURN_START]),priority:100,
        resolve(){hero.state.charged=false;hero.state.pierceUsed=false;hero.state.multiShotUsed=false;hero.state.lastTarget=null;}},
      {id:'magicPierce',name:'魔贯冲击',...this.onOwnAttack([Timing.ATTACK_DECLARED,Timing.ATTACK_HIT,Timing.ATTACK_MISS]),priority:-15,
        filter:({game,player,timing,context})=>hero.isActiveAttack(context)&&(timing===Timing.ATTACK_DECLARED?
          !hero.state.charged&&!hero.state.multiShotUsed&&hero.charge(game,player,'fire').length>0&&game.player(context.targetId).hand.length<game.player(context.targetId).handLimit:!!context.magicPierce),
        *resolve({game,player,context,timing,options}){
          if(timing===Timing.ATTACK_DECLARED){
            const card=yield* hero.pickCharge(game,player,'fire','magicPierce',true);
            if(!card)return;game.discardCovered(player.id,card,{reveal:true,skillId:'magicPierce'});
            context.magicPierce=true;context.amount++;hero.state.pierceUsed=true;
          }else if(timing===Timing.ATTACK_HIT){
            if(!hero.charge(game,player,'fire').length)return;
            const card=yield* hero.pickCharge(game,player,'fire','magicPierceBonus',true);
            if(card){game.discardCovered(player.id,card,{reveal:true,skillId:'magicPierce'});context.amount++;}
          }else yield* game.damageSteps(context.targetId,3,{...options,sourceId:player.id,damageType:'spell',skillId:'magicPierce'});
        }},
      {id:'magicAttackRecord',name:'魔弓攻击记录',...this.onOwnAttack([Timing.ATTACK_DECLARED]),priority:200,
        filter:({context})=>hero.isActiveAttack(context),
        resolve({context}){hero.state.lastTarget=context.targetId;if(context.actionSourceSkillId==='multiShot')context.amount--; }},
      {id:'thunderScatter',name:'雷光散射',
        action(game,player,action={}){
          const n=hero.charge(game,player,'thunder').length;if(hero.state.charged||!n)return null;
          const modes=Array.from({length:n},(_,i)=>({value:String(i+1),label:`移除${i+1}张雷充能：指定目标${i+1}法伤，其余1法伤`}));
          if(action.mode!=null&&!modes.some(m=>m.value===action.mode))return null;
          return {type:'spell',targets:enemies(game,player),modes};
        },
        *resolveAction({game,player,action,targetIds,options}){
          const n=Number(action.mode??1);
          for(let i=0;i<n;i++){const card=yield* hero.pickCharge(game,player,'thunder','thunderScatter');game.discardCovered(player.id,card,{reveal:true,skillId:'thunderScatter'});}
          for(const id of seatOrder(game,player.id,enemies(game,player)))yield* game.damageSteps(id,id===targetIds[0]?n:1,{...options,sourceId:player.id,damageType:'spell',skillId:'thunderScatter'});
        }},
      {id:'multiShot',name:'多重射击',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),priority:-30,
        filter:({game,player})=>!hero.state.pierceUsed&&hero.charge(game,player,'wind').length>0&&hero.state.lastTarget!=null,
        *resolve({game,player}){
          const card=yield* hero.pickCharge(game,player,'wind','multiShot',true);if(!card)return;
          game.discardCovered(player.id,card,{reveal:true,skillId:'multiShot'});hero.state.multiShotUsed=true;
          game.turn.addAttackAction({sourceSkillId:'multiShot'});
        }},
      {id:'multiShotAttack',name:'多重射击（暗系攻击）',
        action(game,player){return (game.turn.nextAction()?.sourceSkillId==='multiShot'||(game.turn.state?.actionSourceSkillId==='multiShot'&&!game.turn.state.completed))?{type:'attack',targets:enemies(game,player).filter(id=>id!==hero.state.lastTarget&&game.canAttackTarget(player.id,id))}:null;},
        *resolveAction({game,player,targetIds,options}){yield* attackSteps(game,player.id,-1,targetIds[0],{...options,virtualAttack:darkAttack,actionSourceSkillId:'multiShot'});}},
      {id:'charge',name:'充能',...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter:({game,player})=>game.canPayEnergy(player.id,'crystal'),
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'charge','充能：消耗1水晶，弃到4张后摸0至4张')))return;
          yield* game.paySkillEnergy(player.id,'crystal');hero.state.charged=true;
          yield* discardHand(game,player.id,Math.max(0,player.hand.length-4),'chargeDiscard',options);
          const n=yield* choice(player.id,'chargeDraw','充能：摸牌数量',Array.from({length:5},(_,value)=>({value,label:`摸${value}张`})).filter(c=>player.hand.length>0||c.value>0),player.hand.length?0:1);
          yield* game.drawSteps(player.id,n,{...options,cause:{type:'directDraw',skillId:'charge'}});
          // Resolve unusable draws before covering; a charging archer must
          // retain a playable hand card even if covered thunder is available.
          game.allowActivationRefresh(player.id,'charge');
          yield* game.ensureActionableHand(player.id,options,{handOnly:true});
          if(!n||!player.hand.length||game.winner)return;
          const usable=new Set(game.usableHandCards(player.id).map(c=>c.id));
          const cards=yield* game.chooseCardSet(player.id,{counts:Array.from({length:Math.min(n,player.hand.length)},(_,i)=>i+1),skillId:'chargeCover',title:'充能：盖牌后至少保留1张可用牌',optional:true,
            cardsFilter:chosen=>player.hand.some(c=>usable.has(c.id)&&!chosen.includes(c))});
          if(cards){game.coverCards(player.id,cards,'charge');yield* game.flushCardMoves(options);yield* trimCovered(game,player,'charge',8,'chargeTrim');}
        }},
      {id:'magicEye',name:'魔眼',...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter:({game,player})=>!hero.state.charged&&game.canPayEnergy(player.id,'gem'),
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'magicEye','魔眼：消耗1宝石，弃牌或摸牌、盖1充能并获得1水晶')))return;
          yield* game.paySkillEnergy(player.id,'gem');
          const canDiscard=!game.turn.state?.seekingAction&&player.hand.length>=3&&game.usableHandCards(player.id).length>0;
          const mode=yield* choice(player.id,'magicEyeMode','魔眼：选择效果',[...(canDiscard?[{value:'discard',label:'目标角色弃1张'}]:[]),{value:'draw',label:'自己摸3张'}],canDiscard?'discard':'draw');
          if(mode==='draw')yield* game.drawSteps(player.id,3,{...options,cause:{type:'directDraw',skillId:'magicEye'}});
          else {
            const targetId=yield* game.choosePlayer(player.id,targets(game),'魔眼：选择弃牌角色',{skillId:'magicEyeTarget'});
            if(targetId===player.id){
              const cards=yield* game.chooseHandCards(player.id,1,()=>true,{skillId:'magicEyeDiscard',title:'魔眼：弃牌后保留可用牌',preserveUsable:true});
              game.discardCards(player.id,cards,{reason:'magicEyeDiscard',visibility:'hidden'});yield* game.flushRuleEvents(options);
            }else yield* discardHand(game,targetId,1,'magicEyeDiscard',options);
          }
          if(player.hand.length){const cards=yield* game.chooseHandCards(player.id,1,()=>true,{skillId:'chargeCover',title:'魔眼：将1张手牌作为充能'});game.coverCards(player.id,cards,'charge');yield* game.flushCardMoves(options);yield* trimCovered(game,player,'charge',8,'chargeTrim');}
          game.gainEnergy(player.id,'crystal');
          // Covering is unrestricted. At activation completion thunder scatter
          // remains a legal continuation; otherwise refresh the unusable hand.
          game.allowActivationRefresh(player.id,'magicEye');
        }},
    ];
  }
  charge(game,p,element){return coveredCards(p,'charge').filter(c=>hasElement(game,p,c,element));}
  *pickCharge(game,p,element,skillId,optional=false){return yield* game.chooseCoveredCard(p.id,'charge',{skillId,title:`选择${element==='fire'?'火':element==='wind'?'风':'雷'}系充能`,optional,predicate:c=>hasElement(game,p,c,element)});}
  allowsAction({game,player,type,skillId}){return !this.skills.length||game.turn.state?.playerId!==player.id||game.turn.nextAction()?.sourceSkillId!=='multiShot'||skillId==='multiShotAttack';}
  allowsCard({game,player,card,purpose}){return !this.skills.length||game.turn.state?.playerId!==player.id||purpose==='response'||game.turn.nextAction()?.sourceSkillId!=='multiShot';}
}
