// A playable reserve is not a hand: it never contributes to hand count, overflow
// or discard fees. Only play/response interfaces use these stable list indices.
export function playableCards(player) {
  if (player.hero.id === 'mystic' && player.hero.state?.castingWordId) return [...player.hand, ...player.covered.filter(c => c.id === player.hero.state.castingWordId)];
  return player.hero.id === 'elfArcher' && player.hero.state?.form === 'elfBlessing'
    ? [...player.hand, ...player.covered.filter(card => card.location.pile === 'blessing')]
    : player.hand;
}
