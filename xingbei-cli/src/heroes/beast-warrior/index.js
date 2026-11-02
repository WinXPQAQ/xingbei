import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, targets } from '../shared/actions.js';
import { discardHand } from '../shared/covered.js';
export class BeastWarrior extends Hero {
  constructor(enabled=true){
    super({id:'beastWarrior',name:'兽灵武士'});this.state={souls:0,residual:0,form:null};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'warriorResidual',name:'武者残心',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),priority:0,
        filter:({game})=>hero.state.residual<4&&!game.turn.state?.usedSkills.warriorResidual,
        *resolve({game,player}){if(!(yield* game.offerSkill(player.id,'warriorResidual','武者残心：+1残心')))return;
          if(game.turn.state)game.turn.state.usedSkills.warriorResidual=true;hero.addResidual(game,player,1,'warriorResidual');}},
      {id:'thoughtlessStrike',name:'一击无念',...this.onOwnTurn([Timing.ATTACK_ACTION_END]),priority:-30,
        filter:()=>hero.state.residual>=4,
        *resolve({game,player}){if(!(yield* game.offerSkill(player.id,'thoughtlessStrike','一击无念：移除4残心，获得强化额外攻击')))return;
          hero.state.residual-=4;game.turn.addAttackAction({sourceSkillId:'thoughtlessStrike'});}},
      {id:'thoughtlessAttack',name:'一击无念攻击',...this.onOwnAttack([Timing.ATTACK_DECISION]),priority:10,
        filter:({context})=>hero.isActiveAttack(context)&&context.actionSourceSkillId==='thoughtlessStrike',
        resolve({context}){context.shieldable=false;context.canHolyLight=false;if(context.attackTraits.fates.includes('J'))context.forceHitRequested=true;}},
      {id:'beastIntent',name:'兽魂意念',...this.onOwnAttack([Timing.ATTACK_HIT]),priority:-30,
        filter:({context})=>!hero.state.form&&hero.isActiveAttack(context),
        resolve:({game,player})=>hero.addSouls(game,player,1,'beastIntent')},
      {id:'beastVigilance',name:'兽魂警戒',...this.bind('actor',[Timing.FORM_ENTERED],'all'),
        filter:({player,context})=>!hero.state.form&&hero.state.souls>0&&context.actorId!==player.id,
        *resolve({game,player,options}) {
          if(!(yield* game.offerSkill(player.id,'beastVigilance','兽魂警戒：移除1兽魂并进入居合形态')))return;
          hero.spendSouls(game,player,1);hero.state.form='iaido';
          const id=yield* game.choosePlayer(player.id,targets(game),'兽魂警戒：选择明弃1张牌的角色',{skillId:'beastVigilance'});
          const cards=yield* discardHand(game,id,1,'beastVigilanceDiscard',options,'public');
          if(cards[0]?.type==='spell')hero.addSouls(game,player,1,'beastVigilance');
        }},
      {id:'beastCounter',name:'兽反',...this.onDamage([Timing.DAMAGE_BEFORE],'target',['spell']),priority:-20,
        filter:({context})=>hero.state.souls>0&&context.sourceId!=null,
        *resolve({game,player,context,options}){
          const n=yield* choice(player.id,'beastCounter','兽反：移除兽魂并弃牌',Array.from({length:hero.state.souls+1},(_,value)=>({value,label:value?`${value}兽魂`:'不发动'})),0,context);
          if(!n)return;hero.spendSouls(game,player,n);
          yield* discardHand(game,player.id,n,'beastCounterCost',options);
          const cards=yield* discardHand(game,context.sourceId,1,'beastCounterDiscard',options,'public');
          if(cards[0]?.type==='spell')hero.addSouls(game,player,1,'beastCounter');
        }},
      {id:'iaidoDamage',name:'御魂流居合形态',...this.onOwnAttack([Timing.ATTACK_HIT]),priority:-26,
        filter:({game,context})=>!!hero.state.form&&!!game.player(context.targetId).hero.state.form,
        resolve:({context})=>{context.amount++;}},
      {id:'iaidoExit',name:'居合形态结束',...this.onDamage([Timing.DAMAGE_ACTUAL],'actor'),priority:100,
        filter:({player,context})=>!!hero.state.form&&context.targetId!==player.id,
        resolve({game,player}){hero.state.form=null;game.logSkill(player.id,'iaidoExit','其他角色承受自身造成的伤害，脱离居合形态');}},
      {id:'iaidoTurnEnd',name:'居合形态回合结束',...this.onOwnTurn([Timing.TURN_END]),priority:10,
        filter:()=>!!hero.state.form,
        resolve({game,player}){if(hero.state.souls)hero.spendSouls(game,player,1);if(!hero.state.souls){hero.state.form=null;game.logSkill(player.id,'iaidoExit','兽魂耗尽，脱离居合形态');}}},
      {id:'reverseIaido',name:'逆反居合斩',...this.onOwnAttack([Timing.ATTACK_DECLARED,Timing.ATTACK_HIT]),priority:100,
        filter:({game,timing,context})=>timing===Timing.ATTACK_DECLARED?!!hero.state.form&&game.player(context.targetId).hand.length<4:context.iaidoCost!=null,
        *resolve({game,player,context,timing,options}){
          if(timing===Timing.ATTACK_DECLARED){
            const choices=[{value:'skip',label:'不发动'},...Array.from({length:hero.state.souls+1},(_,value)=>({value,label:`移除${value}兽魂`}))];
            const n=yield* choice(player.id,'reverseIaido','逆反居合斩：以弃牌替代命中伤害',choices,'skip',context);
            if(n==='skip')return;hero.spendSouls(game,player,n);context.iaidoCost=n;
          }else{
            context.damageReplaced=true;
            const cards=yield* discardHand(game,context.targetId,context.iaidoCost+2,'reverseIaidoDiscard',options);
            context.targetHandCount=game.player(context.targetId).hand.length;
            game.logSkill(player.id,'reverseIaido',`仍算命中，以暗弃${cards.length}张牌替代伤害`);
            if(cards.length<context.iaidoCost+2)game.changeMorale(game.player(context.targetId).team,-1);
          }
        }},
      {id:'iaidoStance',name:'御魂流居合式',...this.onOwnTurn([Timing.ACTIVATION]),
        filter:({game,player})=>game.canPayEnergy(player.id,'gem'),
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'iaidoStance','御魂流居合式：消耗1宝石，+1兽魂')))return;
          yield* game.paySkillEnergy(player.id,'gem');hero.state.souls++;game.logSkill(player.id,'iaidoStance',`无视上限获得1兽魂（${hero.state.souls}）`);
          const mode=yield* choice(player.id,'iaidoStance','可摸或弃1张牌',[{value:'skip',label:'不摸弃'},{value:'draw',label:'摸1张'},...(player.hand.length?[{value:'discard',label:'弃1张'}]:[])],'skip');
          if(mode==='draw')yield* game.drawSteps(player.id,1,{...options,cause:{type:'directDraw',skillId:'iaidoStance'}});
          if(mode==='discard')yield* discardHand(game,player.id,1,'iaidoStanceDiscard',options);
          if(hero.state.form)hero.addResidual(game,player,1,'iaidoStance');else hero.state.form='iaido';
        }},
    ];
  }
  addResidual(game,p,n,id){const before=this.state.residual;this.state.residual=Math.min(4,before+n);game.logSkill(p.id,id,`残心+${this.state.residual-before}（${this.state.residual}/4）`);}
  addSouls(game,p,n,id){const before=this.state.souls;this.state.souls+=Math.max(0,Math.min(n,2-before));game.logSkill(p.id,id,`兽魂+${this.state.souls-before}（${this.state.souls}）`);}
  spendSouls(game,p,n){if(!n)return;this.state.souls-=n;game.logSkill(p.id,'beastIntent',`移除${n}兽魂`);this.addResidual(game,p,n,'beastIntent');}
}
