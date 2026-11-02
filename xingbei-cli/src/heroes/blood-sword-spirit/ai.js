import {damageTarget,usefulExtra,cheapCards} from '../shared/ai/decisions.js';
export const bloodSwordSpiritAi={
  id:'bloodSwordSpirit',acceptsRefine:()=>true,
  cardBonus:({card,same})=>card.type==='attack'?(same?2:9):0,
  resourceValue:p=>(p.heroState.blood??0)*4,
  attackHitBonus:({player})=>player.heroState.blood<3?4:0,
  scoreSkill({next,id,player,targetId,skillId,game},api){
    if(skillId!=='bloodRose')return null;
    player.heroState.blood-=2;next.players[targetId].healing=Math.max(0,next.players[targetId].healing-2);
    const ally=next.players.find(p=>p.team===player.team&&p.energy.crystal>0);if(ally){ally.energy.crystal--;ally.energy.gem++;}
    if([...game.cards.values()].some(c=>c.name==='roseGarden'&&c.location.zone==='field'))for(let step=0;step<6;step++)api.hurt(next,(id+step)%6,1);
    return 0;
  },
  decisions:{
    scarletFlash:(a,api)=>usefulExtra(a,api,2,4),
    bloodBarrier(a,api){if(a.request.type==='playerChoice')return damageTarget(a,api);
      const gain=api.damageGain(a.state,a.id,a.id,Math.max(0,(a.context.amount??1)-1))-api.damageGain(a.state,a.id,a.id,a.context.amount??1);
      return gain+Math.max(...a.state.players.filter(p=>p.team!==a.player.team).map(p=>api.damageGain(a.state,a.id,p.id,1)))>4;
    },
    bloodRoseEnergy:({request,state})=>[...request.choices].sort((a,b)=>Number(state.players[b.value].energy.gem===0)-Number(state.players[a.value].energy.gem===0))[0].value,
    petalDance(a,api){
      if(a.request.type==='cardChoice')return cheapCards(a,api);
      if(a.player.heroState.blood>=3||!a.source.hand.some(c=>c.type==='attack'))return 'skip';
      const allies=a.state.players.filter(p=>p.team===a.player.team),foes=a.state.players.filter(p=>p.team!==a.player.team);
      const exposure=ps=>ps.reduce((n,p)=>n+Math.min(p.healing,Math.max(0,p.count+2-p.limit)),0);
      if(exposure(allies)>exposure(foes)+1)return 'skip';
      return a.request.choices.some(c=>c.value==='gem')&&a.player.count>4?'gem':'crystal';
    },
  },
};
