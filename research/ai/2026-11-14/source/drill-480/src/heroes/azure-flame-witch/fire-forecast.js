import {createDeck} from '../../cards.js';

const printed=createDeck();
const fireRates=Object.fromEntries([false,true].map(form=>[form,printed.filter(card=>card.elements.includes('fire')||
  form&&card.type==='attack'&&card.elements.some(element=>!['water','dark'].includes(element))).length/printed.length]));
export const isKnownFire=(card,id)=>(card.traits?.[id]?.elements??card.elements).includes('fire');

// Only the public printed distribution describes unknown draws. Known traits
// already include the current form and any other visible attribute modifiers.
export function fireReadiness(known,unknown,id,form,minimum=2) {
  const missing=minimum-known.filter(card=>isKnownFire(card,id)).length;
  if(missing<=0)return 1;
  if(unknown<missing)return 0;
  const rate=fireRates[Boolean(form)];
  return missing===1?1-(1-rate)**unknown:1-(1-rate)**unknown-unknown*rate*(1-rate)**(unknown-1);
}
