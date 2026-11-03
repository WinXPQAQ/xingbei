// A playable reserve is not a hand: it never contributes to hand count, overflow
// or discard fees. Only play/response interfaces use these stable list indices.
export function playableCards(player) {
  return player.hero.id === 'elfArcher' && player.hero.state?.form === 'elfBlessing'
    ? [...player.hand, ...player.covered.filter(card => card.location.pile === 'blessing')]
    : player.hand;
}
