import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, enemies, healTarget } from '../shared/actions.js';
import { coveredCards, discardHand } from '../shared/covered.js';
export class MoonGoddess extends Hero {
  constructor(enabled=true){
    super({id:'moonGoddess',name:'月之女神'});this.state={form:null,newMoon:0,petrification:0,desecrationUsed:false,nextUncounterable:false};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'darkMoonCurse',name:'暗月诅咒'},

      {id:'moonReset',name:'月渎回合重置',...this.bind('player',[Timing.TURN_BEFORE],'all'),resolve(){hero.state.desecrationUsed=false;}},
      {id:'newMoonShelter',name:'新月庇护',...this.bind('team',[Timing.MORALE_BEFORE],'self'),priority:-10,
        filter:({context})=>!hero.state.form&&context.amount<0&&context.cause?.type==='damage'&&context.discarded?.length>0,
        *resolve({game,player,context}){
          if(!(yield* game.offerSkill(player.id,'newMoonShelter','新月庇护：免除本次士气损失，以弃牌形成暗月',context)))return;
          hero.state.form='darkMoon';context.amount=0;
          game.coverCards(player.id,context.discarded,'darkMoon',{sources:['discard']});
          game.logSkill(player.id,'newMoonShelter',`进入暗月形态，${context.discarded.length}张爆牌作为暗月，本次士气不下降`);
        }},
      {id:'medusaEye',name:'美杜莎之眼',...this.bind('actor',[Timing.ATTACK_DECLARED],'all'),priority:-15,
        filter:({game,player,context})=>game.player(context.actorId).team!==player.team&&hero.moons(player).some(c=>c.getTraits({game,playerId:player.id}).elements.some(e=>context.attackTraits.elements.includes(e))),
        *resolve({game,player,context,options}){
          const card=yield* game.chooseCoveredCard(player.id,'darkMoon',{skillId:'medusaEye',title:'美杜莎之眼：可移除同系暗月',optional:true,predicate:c=>c.getTraits({game,playerId:player.id}).elements.some(e=>context.attackTraits.elements.includes(e))});
          if(!card)return;yield* hero.removeMoons(game,player,[card],options,true);
          game.changeHealing(player.id,1);hero.state.petrification=Math.min(3,hero.state.petrification+1);
          game.logSkill(player.id,'medusaEye','治疗+1、石化+1');
          if(card.type==='spell'){
            yield* discardHand(game,player.id,1,'medusaEye',options);
            const id=yield* game.choosePlayer(player.id,enemies(game,player),'美杜莎之眼：选择1法伤目标',{skillId:'medusaDamage'});
            yield* game.damageSteps(id,1,{...options,sourceId:player.id,damageType:'spell',skillId:'medusaEye'});
          }
        }},
      {id:'moonCycle',name:'月之轮回',...this.onOwnTurn([Timing.TURN_END]),priority:1,
        *resolve({game,player,options}){
          const choices=[{value:'skip',label:'不发动'}];
          if(hero.moons(player).length)choices.push({value:'moon',label:'移除1暗月，目标+1治疗'});
          if(player.healing)choices.push({value:'healing',label:'移除1治疗，新月+1'});
          if(choices.length===1)return;
          const mode=yield* choice(player.id,'moonCycle','月之轮回',choices,'skip');
          if(mode==='healing'){game.changeHealing(player.id,-1);hero.state.newMoon=Math.min(2,hero.state.newMoon+1);game.logSkill(player.id,'moonCycle','移除1治疗，新月+1');}
          if(mode==='moon'){const card=yield* game.chooseCoveredCard(player.id,'darkMoon',{skillId:'moonCycle',title:'选择移除的暗月'});yield* hero.removeMoons(game,player,[card],options);yield* healTarget(game,player,1,'moonCycle');}
        }},
      {id:'moonDesecration',name:'月渎',...this.onDamage([Timing.DAMAGE_AFTER],'actor',['spell']),
        filter:({player,context})=>!hero.state.desecrationUsed&&player.healing>0&&context.actual>0,
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'moonDesecration','月渎：移除1治疗，对敌人造成1法伤')))return;
          hero.state.desecrationUsed=true;game.changeHealing(player.id,-1);
          const id=yield* game.choosePlayer(player.id,enemies(game,player),'月渎：选择目标',{skillId:'moonDesecration'});
          yield* game.damageSteps(id,1,{...options,sourceId:player.id,damageType:'spell',skillId:'moonDesecration'});
        }},
      {id:'darkMoonSlash',name:'暗月斩',...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter:({game,player,context})=>hero.isActiveAttack(context)&&hero.state.form&&hero.moons(player).length&&game.canPayEnergy(player.id,'crystal'),
        *resolve({game,player,context,options}){
          const n=yield* choice(player.id,'darkMoonSlash','暗月斩：消耗1水晶并移除暗月增伤',Array.from({length:Math.min(2,hero.moons(player).length)+1},(_,value)=>({value,label:value?`移除${value}暗月，伤害+${value}`:'不发动'})),0,context);
          if(!n)return;yield* game.paySkillEnergy(player.id,'crystal');const selected=[];
          for(let i=0;i<n;i++)selected.push(yield* game.chooseCoveredCard(player.id,'darkMoon',{skillId:'darkMoonSelect',predicate:c=>!selected.includes(c)}));
          yield* hero.removeMoons(game,player,selected,options);context.amount+=n;
        }},
      {id:'paleMoon',name:'苍白之月',
        action(game,player,action={}){
          const modes=Array.from({length:hero.state.newMoon+1},(_,n)=>({value:`damage:${n}`,label:`移除${n}新月，石化+1，弃1牌，${n+1}法伤`}));
          if(hero.state.petrification===3)modes.unshift({value:'turn',label:'移除3石化，额外攻击与额外回合'});
          if(action.mode&&!modes.some(m=>m.value===action.mode))return null;
          return {type:'spell',energy:'gem',modes,targets:enemies(game,player),targetCounts:action.mode==='turn'?[0]:action.mode?[1]:[0,1]};
        },
        *resolveAction({game,player,action,targetIds,options}){
          yield* game.paySkillEnergy(player.id,'gem');
          if(action.mode==='turn'){
            hero.state.petrification-=3;hero.state.nextUncounterable=true;game.turn.addAttackAction({sourceSkillId:'paleMoon'});game.turn.addExtraTurn(player.id);
            game.logSkill(player.id,'paleMoon','下次主动攻击无法应战，获得额外攻击及额外回合');return;
          }
          const n=Number((action.mode??'damage:0').split(':')[1]);hero.state.newMoon-=n;hero.state.petrification=Math.min(3,hero.state.petrification+1);
          yield* discardHand(game,player.id,1,'paleMoon',options);
          yield* game.damageSteps(targetIds[0],n+1,{...options,sourceId:player.id,damageType:'spell',skillId:'paleMoon'});
        }},
      {id:'paleMoonAttack',name:'苍白之月攻击',...this.onOwnAttack([Timing.ATTACK_DECLARED]),priority:50,
        filter:({context})=>hero.state.nextUncounterable&&hero.isActiveAttack(context),
        resolve({context}){hero.state.nextUncounterable=false;context.canCounter=false;}},
    ];
  }
  moons(player){return coveredCards(player,'darkMoon');}
  *removeMoons(game,player,cards,options,reveal=false){
    for(const card of cards)game.discardCovered(player.id,card,{reveal,skillId:'darkMoonCurse'});
    // One removal operation costs one morale, even when it removes two cards.
    yield* game.changeMoraleSteps(player.team,-1,{...options,skillId:"newMoon"});yield* game.present();
    if(!this.moons(player).length){this.state.form=null;game.logSkill(player.id,'darkMoonCurse','暗月耗尽，脱离暗月形态');}
    yield* game.flushRuleEvents(options);
  }
}
