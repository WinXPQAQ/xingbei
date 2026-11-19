import { heroAi } from '../shared/ai/wave-three/registry.js';

const elementsOf = (card, id) => card?.traits?.[id]?.elements ?? card?.elements ?? [];
const bullets = (game,id) => game.player(id).covered.filter(card=>card.location.pile==='bullets');
const bulletElements = (card,id) => elementsOf(card,id).some(e=>e==='light'||e==='dark')
  ? ['fire','water','wind','thunder','earth'] : elementsOf(card,id);
const attackCard = (card,id,elements) => ({...card,elements,
  traits:{...card.traits,[id]:{...(card.traits?.[id]??card),elements}}});
const currentCard = ({context,id}) => context.card && context.attackTraits
  ? attackCard(context.card,id,context.attackTraits.elements) : context.card;
const bulletReserve = (card,id,inventory) => {
  const options=bulletElements(card,id), substitutes=inventory.filter(other=>other.id!==card.id&&
    bulletElements(other,id).includes(options.includes('thunder')?'thunder':options[0])).length;
  // These are future option costs in addition to the stock's generic value.
  // A wildcard can replace thunder now, but ordinary thunder is spent first
  // when both perform the same job and the wildcard's flexibility is unneeded.
  return (options.length>1?2.5:options.includes('thunder')?2:1)/(1+substitutes*.3);
};
function effectTarget(state,id,element,api,targets=state.players.map(p=>p.id)) {
  let best={score:-Infinity,targetId:null};
  for(const targetId of targets) {
    const next=api.copy(state);
    if(element==='water')api.heal(next,targetId,1);
    else api.hurt(next,targetId,1,'spell');
    // Water/earth trigger at ATTACK_HIT, before the attack damage. A lethal
    // earth bullet ends the game. Use the same local target evaluation as the
    // actual follow-up target request, which does not contain the attack plan.
    const score=api.evaluate(next);
    if(score>best.score)best={score,targetId};
  }
  return best.targetId;
}
function hitEffect(state,id,element,api) {
  const targetId=effectTarget(state,id,element,api);
  if(targetId==null)return;
  if(element==='water')api.heal(state,targetId,1);
  else api.hurt(state,targetId,1,'spell');
}

function nextSlot(queue) {
  const index=queue.findLastIndex(action=>action.element||action.fate);
  return index<0?0:index;
}
// At most two remaining attacks, with distinct hand cards. Each real target is
// still selected again after the actual hit, counter, draw and other reactions.
function continuationValue(game,state,id,api) {
  if(api.terminal(state)||state.players[id].heroState.rangerNoFollow)return 0;
  const next=api.copy(state), p=next.players[id], queue=[...(next.turn?.pendingActions??[])];
  if(next.turn?.completed&&queue.length)queue.splice(nextSlot(queue),1);
  if(p.heroState.rangerBulletPreview==='wind'||p.heroState.windBulletPending)
    queue.push({type:'attack',sourceSkillId:'bulletShot'});
  if(p.heroState.rangerPreviewHit&&!p.heroState.doubleShadowUsed&&p.heroState.rangerAttackElement)
    queue.push({type:'attack',element:p.heroState.rangerAttackElement,sourceSkillId:'doubleShadow'});
  p.heroState.rangerNoFollow=true;
  p.heroState.rangerBulletPreview=null;
  p.heroState.rangerBaseDamage=2;
  p.heroState.windBulletPending=false;
  let total=0;
  for(let step=0;step<2&&queue.length;step++) {
    const [slot]=queue.splice(nextSlot(queue),1);
    if(slot.type!=='attack')break;
    if(slot.sourceSkillId==='doubleShadow')p.heroState.doubleShadowUsed=true;
    const eligible=p.hand.filter(card=>card.type==='attack'&&(!slot.element||elementsOf(card,id).includes(slot.element))&&
      (!slot.fate||(card.traits?.[id]?.fates??card.fates??[]).includes(slot.fate)));
    if(!eligible.length)break;
    let best={score:0,card:null};
    for(const card of eligible)for(const target of api.foes(next,id).filter(p=>!heroAi(p.hero).blocksActiveAttack?.(p))) {
      const score=api.attackScore(game,id,next,card,target.id,{follow:false});
      if(score>best.score)best={score,card};
    }
    if(!best.card)break;
    total+=best.score*(step?0.65:1);
    api.remove(next,id,[best.card]);
  }
  return total;
}
function attackValue(game,state,id,card,targetId,element,api) {
  const next=api.copy(state),p=next.players[id];
  p.heroState.rangerBulletPreview=element;
  if(element)p.coveredCount--;
  const outcomes=api.attackOutcomes(game,id,next,card,targetId,{alreadyPlayed:true});
  return api.scoreBranches(outcomes)+outcomes.reduce((sum,branch)=>sum+branch.probability*
    ((branch.bonus??0)+continuationValue(game,branch.state,id,api)),0);
}
function bulletOptions({game,state,id,card,targetId,alreadyPlayed=false,amount=2,inventory=bullets(game,id)},api) {
  if(!card||targetId==null)return {baseline:api.evaluate(state),options:[]};
  const before=api.copy(state);
  before.players[id].heroState.rangerBaseDamage=amount;
  if(!alreadyPlayed) {
    const selected=before.players[id].hand.find(c=>c.id===card.id);
    if(!selected)return {baseline:api.evaluate(state),options:[]};
    api.spend(before,id,[selected]);
  }
  const baseline=attackValue(game,before,id,card,targetId,null,api), values=new Map();
  const options=[];
  for(const bullet of inventory)for(const element of bulletElements(bullet,id)) {
    if(!values.has(element))values.set(element,attackValue(game,before,id,card,targetId,element,api));
    options.push({cardId:bullet.id,element,score:values.get(element)-baseline-bulletReserve(bullet,id,inventory)});
  }
  return {baseline,options:options.sort((a,b)=>b.score-a.score)};
}
function currentBullets(a,api) {
  return bulletOptions({...a,card:currentCard(a),targetId:a.context.targetId,alreadyPlayed:true,amount:a.context.amount??2},api);
}
function swordDanceGain(a,api) {
  const card=currentCard(a);
  if(!card||elementsOf(card,a.id).includes('wind')||a.context.targetId==null)return -Infinity;
  const before=currentBullets(a,api), next=api.copy(a.state);
  api.payEnergy(next,a.id,1,'crystal');
  const after=bulletOptions({...a,state:next,card:attackCard(card,a.id,['wind']),
    targetId:a.context.targetId,alreadyPlayed:true,amount:a.context.amount??2},api);
  return after.baseline+Math.max(0,after.options[0]?.score??0)-before.baseline-Math.max(0,before.options[0]?.score??0)-3;
}
export const rangerAi = {
  id:'ranger',
  energyPreference:'crystal',
  cardBonus:({card,elements,same})=>card.type==='attack'?(elements.includes('wind')?16:8)+(same?10:0):0,
  resourceValue:p=>p.coveredCount*3+Math.min(1,p.energy.gem+p.energy.crystal)*2,
  prepareAttack({player,card,id,active}) {
    if(!active)return;
    player.heroState.rangerPreviewHit=false;
    player.heroState.rangerAttackElement=elementsOf(card,id)[0]??null;
  },
  beforeAttackHit({state,id,active},api) {
    const p=state.players[id];p.heroState.rangerPreviewHit=true;
    if(active&&['water','earth'].includes(p.heroState.rangerBulletPreview))
      hitEffect(state,id,p.heroState.rangerBulletPreview,api);
  },
  uncounterable:({player,active})=>active&&player.heroState.rangerBulletPreview==='thunder',
  attackDamage:({player,active})=>active?(player.heroState.rangerBaseDamage??2)-2+Number(player.heroState.rangerBulletPreview==='fire'):0,
  followAttackScore({game,state,id,active,branches},api) {
    if(!active||state.players[id].heroState.rangerNoFollow)return 0;
    return branches.reduce((sum,branch)=>sum+branch.probability*continuationValue(game,branch.state,id,api),0);
  },
  actionBonus({game,state,id,action},api) {
    const card=action.type==='play'?state.players[id].hand[action.index]:null;
    if(card?.type!=='attack')return 0;
    return Math.max(0,bulletOptions({game,state,id,card,targetId:action.targetId},api).options[0]?.score??0);
  },
  decisions:{
    bulletShot(a,api) {
      const {options}=currentBullets(a,api);
      const best=options.find(option=>a.request.choices.some(c=>c.value===option.cardId));
      return best?.score>0?best.cardId:null;
    },
    bulletElement(a,api) {
      const card=currentCard(a);
      if(!card||a.context.targetId==null)return a.request.defaultValue;
      const state=api.copy(a.state);state.players[a.id].heroState.rangerBaseDamage=a.context.amount??2;
      return [...a.request.choices].map(choice=>({value:choice.value,
        score:attackValue(a.game,state,a.id,card,a.context.targetId,choice.value,api)}))
        .sort((x,y)=>y.score-x.score)[0]?.value??a.request.defaultValue;
    },
    earthBullet:({state,id,request},api)=>effectTarget(state,id,'earth',api,request.choices.map(c=>c.value)),
    waterBullet:({state,id,request},api)=>effectTarget(state,id,'water',api,request.choices.map(c=>c.value)),
    doubleShadow({game,state,id,context},api) {
      const next=api.copy(state),p=next.players[id];p.heroState.rangerNoFollow=true;
      const cards=p.hand.filter(card=>card.type==='attack'&&elementsOf(card,id).includes(context.element));
      return cards.some(card=>api.foes(next,id).filter(p=>!heroAi(p.hero).blocksActiveAttack?.(p))
        .some(target=>api.attackScore(game,id,next,card,target.id,{follow:false})>0));
    },
    elfSwordDance:(a,api)=>swordDanceGain(a,api)>0,
    bulletEnchant({request,source,state,game,id},api) {
      let best={value:null,score:0};
      for(const index of request.valid??[]) {
        const card=source.hand[index], next=api.copy(state);
        api.remove(next,id,[card]);api.payEnergy(next,id,1,'crystal');next.players[id].coveredCount++;
        if(!next.players[id].hand.some(c=>c.type==='attack'))continue;
        const score=api.evaluate(next)-api.evaluate(state)-api.cardCost(game,id,[card])-3+
          bulletReserve(card,id,[card]);
        if(score>best.score)best={value:[index],score};
      }
      return best.value;
    },
    bulletEnergy:({request})=>request.choices.find(c=>c.value==='crystal')?.value??request.defaultValue,
  },
};
