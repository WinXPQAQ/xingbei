import { Hero } from '../../hero-base.js';
import { ExclusiveCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { choice, targets, discardCost, useUnique } from '../shared/actions.js';
import { discardHand, seatOrder } from '../shared/covered.js';
export class BloodWitch extends Hero {
  constructor(enabled=true){
    super({id:'bloodWitch',name:'血之巫女'});this.state={form:null,fateCardId:null,linkedPlayerId:null};
    if(!enabled)return;const hero=this;
    this.skills=[
      {id:'sharedFateLimit',name:'同生共死手限',modifyHandLimit:(limit,p)=>hero.state.linkedPlayerId!=null&&hero.state.linkedPlayerId!==p.id?limit+(hero.state.form?1:-2):limit},
      {id:'bleeding',name:'流血',...this.onOwnTurn([Timing.MORALE_AFTER]),
        filter:({context})=>!hero.state.form&&context.amount<0&&context.cause?.type==='damage',
        *resolve({game,player,options}){hero.state.form='bleeding';game.changeHealing(player.id,1);game.logSkill(player.id,'bleeding','进入流血形态，治疗+1');yield* hero.checkLimits(game,player,options);}},
      {id:'bleedingReset',name:'流血重置',...this.onOwnTurn([Timing.HAND_CHANGED]),priority:100,
        filter:({player})=>!!hero.state.form&&player.hand.length<3,
        *resolve({game,player,options}){hero.state.form=null;game.logSkill(player.id,'bleeding','手牌少于3，立即脱离流血形态');yield* hero.checkLimits(game,player,options);}},
      {id:'bleedingStart',name:'流血自伤',...this.onOwnTurn([Timing.TURN_START]),
        filter:()=>!!hero.state.form,
        *resolve({game,player,options}){yield* game.damageSteps(player.id,1,{...options,sourceId:player.id,damageType:'spell',skillId:'bleeding'});}},
      {id:'bloodSorrow',name:'血之哀伤',...this.onOwnTurn([Timing.ACTIVATION]),
        filter:({game})=>game.cards.get(hero.state.fateCardId)?.location.zone==='status',
        *resolve({game,player,options}){
          if(!(yield* game.offerSkill(player.id,'bloodSorrow','血之哀伤：自受2法伤，转移或移除同生共死')))return;
          yield* game.damageSteps(player.id,2,{...options,sourceId:player.id,damageType:'spell',skillId:'bloodSorrow'});
          const card=game.cards.get(hero.state.fateCardId),previous=card.location.playerId;
          const mode=yield* choice(player.id,'bloodSorrowMode','血之哀伤',[{value:'move',label:'转移'},{value:'remove',label:'移除'}],'move');
          game.removeEffect(card.id,{zone:'outside'});hero.state.linkedPlayerId=null;
          if(mode==='move'){
            const id=yield* game.choosePlayer(player.id,targets(game).filter(id=>id!==previous),'同生共死：选择新目标',{skillId:'sharedFate'});
            hero.attach(game,player,id);
          }
          yield* hero.checkLimits(game,player,options,[previous]);
        }},
      {id:'reverseFlow',name:'逆流',action:()=>hero.state.form?{type:'spell',cardCount:2,targetCount:0}:null,
        *resolveAction({game,player,cards,options}){yield* discardCost(game,player,cards,'reverseFlow',options,'hidden');game.changeHealing(player.id,1);}},
      {id:'bloodLament',name:'血之悲鸣',
        action:game=>hero.state.form?{type:'spell',cardCount:1,cardFilter:c=>c.hasUniqueSkill('bloodLament'),targets:targets(game),modes:[1,2,3].map(n=>({value:String(n),label:`双方各受${n}法伤`}))}:null,
        *resolveAction({game,player,cards,targetIds,action,options}){
          yield* useUnique(game,player,cards[0],options);
          for(const targetId of [targetIds[0],player.id])yield* game.damageSteps(targetId,Number(action.mode??1),{...options,sourceId:player.id,damageType:'spell',skillId:'bloodLament'});
        }},
      {id:'sharedFate',name:'同生共死',
        action:game=>game.cards.get(hero.state.fateCardId)?.location.zone==='outside'?{type:'spell',targets:targets(game)}:null,
        *resolveAction({game,player,targetIds,options}){yield* game.drawSteps(player.id,2,{...options,cause:{type:'directDraw',skillId:'sharedFate'}});hero.attach(game,player,targetIds[0]);yield* hero.checkLimits(game,player,options);}},
      {id:'bloodCurse',name:'血之诅咒',action:game=>({type:'spell',energy:'gem',targets:targets(game)}),
        *resolveAction({game,player,targetIds,options}){yield* game.paySkillEnergy(player.id,'gem');yield* game.damageSteps(targetIds[0],2,{...options,sourceId:player.id,damageType:'spell',skillId:'bloodCurse'});yield* discardHand(game,player.id,3,'bloodCurse',options);}},
    ];
  }
  initialize(game,player){
    if(!this.skills.length)return;this.state.linkedPlayerId=null;this.state.fateCardId=`sharedFate:${player.id}`;
    if(!game.effects.has('sharedFate'))game.registerEffect('sharedFate',{name:'同生共死',category:'exclusive'});
    game.registerCard(new ExclusiveCard({id:this.state.fateCardId,name:'sharedFate',skills:[{id:'sharedFateHandLimit',name:'同生共死手限',modifyHandLimit:limit=>limit+(this.state.form?1:-2)}]}),{zone:'outside'});
  }
  attach(game,player,id){this.state.linkedPlayerId=id;game.attachCard(this.state.fateCardId,id,{effectId:'sharedFate',sourcePlayerId:player.id,sourceSkillId:'sharedFate'});}
  *checkLimits(game,player,options,others=[]){
    const id=game.cards.get(this.state.fateCardId)?.location.playerId;
    for(const targetId of seatOrder(game,player.id,[...new Set([player.id,...(id==null?[]:[id]),...others])]))yield* game.drawSteps(targetId,0,{...options,moraleLoss:false,cause:{type:'handLimit',skillId:'sharedFate'}});
  }
}
