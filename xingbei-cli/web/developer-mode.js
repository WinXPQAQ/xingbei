// Only the developer mode command handler calls this. Ordinary turn rules stay strict.
export function skipDeveloperAction(game, mode) {
  if (mode !== "developer") throw new Error("只有开发者模式可以跳过行动");
  const state = game.turn.state;
  if (!state || game.winner || game.players.some(player => player.pendingOverflow)) {
    throw new Error("当前不能推进回合");
  }
  state.pendingActions = [];
  state.completed = true;
  game.log.push(`开发者操作：${game.player(state.playerId).name}跳过剩余行动，进入回合结束`);
}
