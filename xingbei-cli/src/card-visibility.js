// Face-down basic effects remain entities, but their printed traits are private.
export const hiddenEffectFor = (card, observerId) =>
  card.location?.zone === "status" &&
  card.attachment?.data?.hidden === true &&
  !(card.attachment.data.knownTo ?? []).includes(observerId);
