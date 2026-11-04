import { Hero } from '../../hero-base.js';
import { ExclusiveCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { choice, targets, discardCost, useUnique } from '../shared/actions.js';
export class SoulWarlock extends Hero {
  constructor(enabled=true) {
    super({id:'soulWarlock',name:'灵魂术士'});
    this.state={yellowSoul:0,blueSoul:0,linkCardId:null};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'soulDevour',name:'灵魂吞噬',...this.bind('team',[Timing.MORALE_AFTER],'self'),
        filter:({context})=>context.amount<0,
        resolve({game,player,context}){hero.gain(game,player,'yellowSoul',-context.amount,'soulDevour');}},
      {id:'soulRecall',name:'灵魂召还',
        action:(_game,player)=>({type:'spell',cardCounts:Array.from({length:player.hand.length},(_,i)=>i+1),cardFilter:c=>c.type==='spell',targetCount:0}),
        *resolveAction({game,player,cards,options}){yield* discardCost(game,player,cards,'soulRecall',options);hero.gain(game,player,'blueSoul',cards.length,'soulRecall');}},
      {id:'soulConvert',name:'灵魂转换',...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter:({context})=>hero.isActiveAttack(context)&&(hero.state.yellowSoul||hero.state.blueSoul),
        *resolve({game,player}){
          const choices=[{value:'skip',label:'不转换'}];
          if(hero.state.yellowSoul)choices.push({value:'yellowSoul',label:'黄色转为蓝色'});
          if(hero.state.blueSoul)choices.push({value:'blueSoul',label:'蓝色转为黄色'});
          const from=yield* choice(player.id,'soulConvert','灵魂转换',choices,'skip');
          if(from==='skip')return;hero.state[from]--;hero.gain(game,player,from==='yellowSoul'?'blueSoul':'yellowSoul',1,'soulConvert');
        }},
      {id:'soulMirror',name:'灵魂镜像',
        action:game=>hero.state.yellowSoul>=2?{type:'spell',cardCount:2,targets:targets(game)}:null,
        *resolveAction({game,player,cards,targetIds,options}){
          hero.state.yellowSoul-=2;yield* discardCost(game,player,cards,'soulMirror',options,'hidden');
          const target=game.player(targetIds[0]);
          yield* game.drawSteps(target.id,Math.min(2,Math.max(0,target.handLimit-target.hand.length)),{...options,cause:{type:'directDraw',skillId:'soulMirror'}});
        }},
      ...[['soulTreasure','灵魂震爆','yellowSoul'],['soulGrant','灵魂赋予','blueSoul']].map(([id,name,resource])=>({
        id,name,action:game=>hero.state[resource]>=3?{type:'spell',cardCount:1,cardFilter:c=>c.hasUniqueSkill(id),targets:targets(game)}:null,
        *resolveAction({game,player,cards,targetIds,options}){
          hero.state[resource]-=3;yield* useUnique(game,player,cards[0],options);
          const target=game.player(targetIds[0]);
          if(id==='soulGrant')game.gainEnergy(target.id,'gem',2);
          else yield* game.damageSteps(target.id,3+(target.hand.length<3&&target.handLimit>5?2:0),{...options,sourceId:player.id,damageType:'spell',skillId:id});
        },
      })),
      {id:'soulLink',name:'灵魂链接',...this.onOwnTurn([Timing.ACTIVATION]),
        filter:({game,player})=>game.cards.get(hero.state.linkCardId)?.location.zone==='outside'&&hero.state.yellowSoul>0&&hero.state.blueSoul>0&&game.players.filter(p=>p.team===player.team&&p.id!==player.id).length>1,
        *resolve({game,player}){
          if(!(yield* game.offerSkill(player.id,'soulLink','灵魂链接：消耗黄蓝灵魂各1，连接队友')))return;
          const targetId=yield* game.choosePlayer(player.id,game.players.filter(p=>p.team===player.team&&p.id!==player.id).map(p=>p.id),'灵魂链接：选择队友',{skillId:'soulLink'});
          hero.state.yellowSoul--;hero.state.blueSoul--;
          game.attachCard(hero.state.linkCardId,targetId,{effectId:'soulLink',sourcePlayerId:player.id,sourceSkillId:'soulLink'});
        }},
      {id:'soulTransfer',name:'灵魂链接转移',...this.bind('target',[Timing.DAMAGE_ACTUAL],'team'),priority:20,
        filter:({game,player,context})=>context.actual>0&&!context.soulTransfer&&hero.state.blueSoul>0&&game.cards.get(hero.state.linkCardId)?.location.zone==='status'&&[player.id,game.cards.get(hero.state.linkCardId).location.playerId].includes(context.targetId),
        *resolve({game,player,context}){
          const linked=game.cards.get(hero.state.linkCardId).location.playerId,targetId=context.targetId===player.id?linked:player.id;
          const n=yield* choice(player.id,'soulTransfer','灵魂链接：转移多少实际伤害',Array.from({length:Math.min(context.actual,hero.state.blueSoul)+1},(_,value)=>({value,label:value?`转移${value}点至${game.actorLabel(targetId)}`:'不转移'})),0,{...context,transferTargetId:targetId});
          if(!n)return;hero.state.blueSoul-=n;context.actual-=n;
          (context.transfers??=[]).push({actorId:player.id,sourceId:player.id,targetId,amount:n,actual:n,damageType:'spell',skillId:'soulTransfer',soulTransfer:true});
          game.logSkill(player.id,'soulTransfer',`消耗${n}蓝色灵魂，${n}点实际伤害转为${game.actorLabel(targetId)}承受的法术伤害⑥`);
        }},
      {id:'soulAmplify',name:'灵魂增幅',...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: ({ player }) => player.hand.length >= 2 || player.hand.some(c => (c.hasUniqueSkill('soulGrant') && player.hero.state.blueSoul >= 1) || (c.hasUniqueSkill('soulTreasure') && player.hero.state.yellowSoul >= 1)),
        filter:({game,player})=>game.canPayEnergy(player.id,'gem'),
        *resolve({game,player}){if(!(yield* game.offerSkill(player.id,'soulAmplify','灵魂增幅：1宝石换取黄蓝灵魂各2')))return;yield* game.paySkillEnergy(player.id,'gem');hero.gain(game,player,'yellowSoul',2,'soulAmplify');hero.gain(game,player,'blueSoul',2,'soulAmplify');}},
    ];
  }
  initialize(game,player){
    if(!this.skills.length)return;this.state.linkCardId=`soulLink:${player.id}`;
    if(!game.effects.has('soulLink'))game.registerEffect('soulLink',{name:'灵魂链接',category:'exclusive'});
    game.registerCard(new ExclusiveCard({id:this.state.linkCardId,name:'soulLink'}),{zone:'outside'});
  }
  gain(game,player,key,n,skillId){const before=this.state[key];this.state[key]=Math.min(6,before+n);game.logSkill(player.id,skillId,`${key==='yellowSoul'?'黄色':'蓝色'}灵魂+${this.state[key]-before}（${this.state[key]}/6）`);}
}
