import { Hero } from '../../hero-base.js';
import { AttackCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { attackSteps } from '../../resolution/attack.js';
import { sameElements } from '../../card-sets.js';
import { choice, enemies, discardCost } from '../shared/actions.js';
import { discardHand, seatOrder } from '../shared/covered.js';
const allies=(game,p,self=false)=>game.players.filter(t=>t.team===p.team&&(self||t.id!==p.id)).map(t=>t.id);
export class HolyArcher extends Hero {
  constructor(enabled=true){
    super({id:'holyArcher',name:'圣弓'});this.state={form:null,faith:0,cannon:1};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'autoFillReward',name:'自动填充'},

      {id:'heavenBow',name:'天之弓',...this.onOwnAttack([Timing.ATTACK_DECLARED,Timing.ATTACK_HIT]),modifyHealingLimit:n=>n+1,
        filter:({context})=>hero.isActiveAttack(context),
        resolve({game,player,timing,context}){const holy=context.attackTraits.fates.includes('S');if(timing===Timing.ATTACK_DECLARED&&!holy)context.amount--;if(timing===Timing.ATTACK_HIT&&holy)hero.gainFaith(game,player,1,'heavenBow');}},
      {id:'holyHurricane',name:'圣屑飓暴',
        action:(game,p)=>({type:'spell',cardCount:2,cardFilter:c=>c.type==='attack',cardsFilter:cs=>sameElements(game,p.id,cs),targets:enemies(game,p).filter(id=>game.canAttackTarget(p.id,id))}),
        *resolveAction({game,player,cards,targetIds,options}){
          const element=cards[0].getTraits({game,playerId:player.id}).elements.find(e=>cards[1].getTraits({game,playerId:player.id}).elements.includes(e));
          yield* discardCost(game,player,cards,'holyHurricane',options);
          const virtual={id:null,name:`${element}Strike`,type:'attack',uniqueSkills:[],getTraits:()=>({elements:[element],fates:['S']}),hasUniqueSkill:()=>false,canRespond:AttackCard.prototype.canRespond};
          yield* attackSteps(game,player.id,-1,targetIds[0],{...options,virtualAttack:virtual,actionSourceSkillId:'holyHurricane'});
        }},
      {id:'holyHurricaneMiss',name:'圣屑飓暴弃牌',...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter:({player,context})=>context.actionSourceSkillId==='holyHurricane'&&player.healing>0,
        *resolve({game,player,options}){
          const n=yield* choice(player.id,'holyHurricaneMiss','移除治疗，让队友弃牌',Array.from({length:Math.min(2,player.healing)+1},(_,value)=>({value,label:value?`移除${value}治疗，队友弃${value}牌`:'不发动'})),0);
          if(!n)return;game.changeHealing(player.id,-n);
          const id=yield* game.choosePlayer(player.id,allies(game,player),'圣屑飓暴：选择弃牌队友',{skillId:'holyHurricaneTarget'});yield* discardHand(game,id,n,'holyHurricaneDiscard',options);
        }},
      {id:'radiantDescent',name:'圣煌降临',
        action(game,p){const modes=[];if(p.healing>=2)modes.push({value:'healing',label:'消耗2治疗'});if(hero.state.faith>=2)modes.push({value:'faith',label:'消耗2信仰'});return !hero.state.form&&modes.length?{type:'spell',targetCount:0,modes}:null;},
        *resolveAction({game,player,action}){if(action.mode==='healing')game.changeHealing(player.id,-2);else hero.state.faith-=2;hero.state.form='radiant';game.turn.addAction({type:'spell',sourceSkillId:'radiantDescent'});}},
      {id:'radiantReset',name:'圣煌重置',...this.onOwnTurn([Timing.SPECIAL_ACTION_END]),
        filter:()=>!!hero.state.form,
        *resolve({game,player}){hero.state.form=null;yield* hero.reward(game,player,1,'radiantReset');}},
      {id:'holyBurst',name:'圣光爆裂',
        action(game,p,action={}){
          if(!hero.state.form)return null;
          const modes=[{value:'support',label:'摸1牌，移除1治疗，信仰+1，队友治疗+1'}];
          for(let n=1;n<=Math.min(p.healing,p.hand.length);n++)if(enemies(game,p).some(id=>game.player(id).hand.length<=p.hand.length-n))modes.push({value:`attack:${n}`,label:`移除${n}治疗并弃${n}牌，对最多${n}人造成攻击伤害`});
          if(action.mode&&!modes.some(m=>m.value===action.mode))return null;
          const n=Number(action.mode?.split(':')[1]);
          return {type:'spell',modes,targets:n?enemies(game,p).filter(id=>game.player(id).hand.length<=p.hand.length-n):allies(game,p),targetCounts:n?Array.from({length:Math.min(n,3)},(_,i)=>i+1):[1],healingCost:n||0};
        },
        *resolveAction({game,player,action,targetIds,options}){
          if((action.mode??'support')==='support'){
            yield* game.drawSteps(player.id,1,{...options,cause:{type:'directDraw',skillId:'holyBurst'}});
            game.changeHealing(player.id,-1);hero.gainFaith(game,player,1,'holyBurst');game.changeHealing(targetIds[0],1);return;
          }
          const n=Number(action.mode.split(':')[1]);game.changeHealing(player.id,-n);
          yield* discardHand(game,player.id,n,'holyBurst',options);
          const amount=2+targetIds.filter(id=>game.player(id).healing>0).length;
          for(const id of seatOrder(game,player.id,targetIds))yield* game.damageSteps(id,amount,{...options,sourceId:player.id,damageType:'attack',skillId:'holyBurst'});
        }},
      {id:'meteorHolyShot',name:'流星圣弹',...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter:({player,context})=>hero.state.form&&hero.isActiveAttack(context)&&(player.healing||hero.state.faith),
        *resolve({game,player}){
          const choices=[{value:'skip',label:'不发动'},...(player.healing?[{value:'healing',label:'移除1治疗'}]:[]),...(hero.state.faith?[{value:'faith',label:'移除1信仰'}]:[])];
          const cost=yield* choice(player.id,'meteorHolyShot','流星圣弹',choices,'skip');if(cost==='skip')return;
          if(cost==='healing')game.changeHealing(player.id,-1);else hero.state.faith--;
          const id=yield* game.choosePlayer(player.id,allies(game,player,true),'流星圣弹：我方目标+1治疗',{skillId:'meteorHolyTarget'});game.changeHealing(id,1);
        }},
      {id:'radiantCannon',name:'圣煌辉光炮',
        action:(game,p)=>hero.state.form&&hero.state.cannon&&hero.state.faith>=hero.cannonCost(game,p)?{type:'spell',targetCount:0}:null,
        *resolveAction({game,player,options}){
          hero.state.faith-=hero.cannonCost(game,player);hero.state.cannon--;
          for(const id of seatOrder(game,player.id))yield* game.adjustHandSteps(id,4,{...options,skillId:'radiantCannon'});
          game.teams[player.team].cups++;game.logSkill(player.id,'radiantCannon','全员手牌调整至4，我方星杯+1');game.recordPresentation('cups',{team:player.team,amount:1});game.checkWinner();yield* game.present();
          const team=yield* choice(player.id,'radiantCannonMorale','选择调整士气的一方',[{value:'red',label:'红方士气调整为蓝方'},{value:'blue',label:'蓝方士气调整为红方'}],player.team);
          yield* game.changeMoraleSteps(team,game.teams[team==='red'?'blue':'red'].morale-game.teams[team].morale,{...options,skillId:'radiantCannon'});yield* game.flushRuleEvents(options);
        }},
      {id:'autoFill',name:'自动填充',...this.onOwnTurn([Timing.TURN_END]),
        filter:({game,player,context})=>context.route!=='special'&&game.canPayEnergy(player.id,'crystal'),
        *resolve({game,player}){
          const costs=[{value:'crystal',label:'水晶：+1信仰或治疗'}];if(game.canPayEnergy(player.id,'gem'))costs.push({value:'gem',label:'宝石：获得1水晶，+2信仰或治疗'});
          const cost=yield* choice(player.id,'autoFill','自动填充（必须发动）',costs,costs[0].value);
          yield* game.paySkillEnergy(player.id,cost);if(cost==='gem')game.gainEnergy(player.id,'crystal');yield* hero.reward(game,player,cost==='gem'?2:1,'autoFillReward');
        }},
    ];
  }
  initialize(game,p){if(this.skills.length)game.gainEnergy(p.id,'crystal',2);}
  cannonCost(game,p){return 4+Math.max(0,game.teams[p.team==='red'?'blue':'red'].morale-game.teams[p.team].morale);}
  gainFaith(game,p,n,skillId){const old=this.state.faith;this.state.faith=Math.min(10,old+n);game.logSkill(p.id,skillId,`信仰+${this.state.faith-old}（${this.state.faith}/10）`);}
  *reward(game,p,n,skillId){const type=yield* choice(p.id,skillId,'选择获得信仰或治疗',[{value:'faith',label:`信仰+${n}`},{value:'healing',label:`治疗+${n}`}],'faith');if(type==='faith')this.gainFaith(game,p,n,skillId);else game.changeHealing(p.id,n);}
}
