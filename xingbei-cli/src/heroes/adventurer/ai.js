export const adventurerAi={
 id:'adventurer',cardBonus:({same})=>same?8:0, resourceValue:p=>p.energy.crystal*3,
 scoreSkill({skillId,next,id,player,action,targetId},{hurt,stones,payEnergy}) {
  if(skillId==='deception'){hurt(next,targetId,2,'attack');player.energy.crystal=Math.min(3,player.energy.crystal+1);return action.mode==='dark'?2:-3;}
  if(skillId==='adventurerParadise'){const[g,c]=(action.mode??'0:1').split(':').map(Number);if(g+c<2)return -30;next.teams[player.team].gem-=g;next.teams[player.team].crystal-=c;next.players[targetId].energy.gem+=g;next.players[targetId].energy.crystal+=c;if(player.energy.gem+player.energy.crystal)payEnergy(next,id,1,'crystal');return 3;}
  if(skillId==='sleightOfHand'){const team=next.teams[player.team];if(action.mode==='steal'){next.teams[player.team==='red'?'blue':'red'].gem--;stones(next,player.team,'gem',1);}else{team.gem+=team.crystal;team.crystal=0;}return player.hand.some(c=>c.type==='attack')?5:0;}
  return null;
 },
 decisions:{sleightOfHand:({player})=>player.hand.some(c=>c.type==='attack')?'attack':'spell'}
};
