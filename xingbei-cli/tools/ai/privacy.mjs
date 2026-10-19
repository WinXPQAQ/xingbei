// Auxiliary direct-access diagnostic, NOT a security boundary. Reflection on
// these live proxies is not isolated. Production isolation is observation.js.
// Evaluation-time capability check. The evaluator retains full state for metrics,
// but strategies receive only their own hand and public objects. This adapter
// intentionally throws on hidden access instead of silently returning fake cards.
export function policyView(game, observerId) {
  const deny = () => { throw new Error(`AI ${observerId} attempted hidden-state access`); };
  const countsOnly = cards => new Proxy(cards, { get: (target, key) => key === 'length' ? target.length : deny(), set: deny });
  const players = game.players.map(player => player.id === observerId ? player : new Proxy(player, {
    get: (target, key) => key === 'hand' ? countsOnly(target.hand) : Reflect.get(target, key), set: deny,
  }));
  const publicCards = new Map([...game.player(observerId).hand, ...game.field, ...game.outside, ...game.players.flatMap(p => p.statuses)].map(c => [c.id,c]));
  const registry = { get: id => publicCards.has(id) ? publicCards.get(id) : deny() };
  let view;
  const turn = new Proxy(game.turn, { get: (target,key) => key === 'game' ? view : Reflect.get(target,key), set: deny });
  view = new Proxy(game, {
    get(target,key) {
      if(key==='players')return players;
      if(key==='turn')return turn;
      if(key==='cards')return registry;
      if(key==='deck'||key==='discard')return countsOnly(target[key]);
      if(['random','log','presentationEvents','onPresentation','onDecision','pendingRuleEvents','triggers'].includes(key))return deny();
      return Reflect.get(target,key);
    }, set: deny,
  });
  return view;
}
export function publicRequest(request, view) {
  const result={...request};
  for(const key of ['actor','target','player','previousActor','nextTarget'])if(result[key]?.id!=null)result[key]=view.player(result[key].id);
  for(const key of ['counterTargets','targets'])if(Array.isArray(result[key]))result[key]=result[key].map(p=>typeof p==='object'?view.player(p.id):p);
  return result;
}
