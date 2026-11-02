import adventurer from '../../src/heroes/adventurer/observation.js';
import fighter from '../../src/heroes/fighter/observation.js';
import brave from '../../src/heroes/brave/observation.js';
import redLotusKnight from '../../src/heroes/red-lotus-knight/observation.js';
import magicLancer from '../../src/heroes/magic-lancer/observation.js';
import bard from '../../src/heroes/bard/observation.js';
import berserker from '../../src/heroes/berserker/observation.js';
import windSwordmaster from '../../src/heroes/wind-swordmaster/observation.js';
import marksman from '../../src/heroes/marksman/observation.js';
import sealer from '../../src/heroes/sealer/observation.js';
import guardianAngel from '../../src/heroes/guardian-angel/observation.js';
import priest from '../../src/heroes/priest/observation.js';
import saint from '../../src/heroes/saint/observation.js';
import holyLancer from '../../src/heroes/holy-lancer/observation.js';
import plagueMage from '../../src/heroes/plague-mage/observation.js';
import elementalist from '../../src/heroes/elementalist/observation.js';
import valkyrie from '../../src/heroes/valkyrie/observation.js';
import magicalGirl from '../../src/heroes/magical-girl/observation.js';
import assassin from '../../src/heroes/assassin/observation.js';
import magicSwordsman from '../../src/heroes/magic-swordsman/observation.js';
import adjudicator from '../../src/heroes/adjudicator/observation.js';
import sage from '../../src/heroes/sage/observation.js';
import prayer from '../../src/heroes/prayer/observation.js';
import heroicPuppet from '../../src/heroes/heroic-puppet/observation.js';

export const heroFields = Object.freeze({adventurer,fighter,brave,redLotusKnight,magicLancer,bard,berserker,windSwordmaster,marksman,sealer,guardianAngel,priest,saint,holyLancer,plagueMage,elementalist,valkyrie,magicalGirl,assassin,magicSwordsman,adjudicator,sage,prayer,heroicPuppet});
export function declaredState(player, observerId) {
  const fields = heroFields[player.hero.id];
  if (!fields) throw new Error(`Hero lacks observation contract: ${player.hero.id}`);
  for (const key of Object.keys(player.hero.state)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Undeclared hero state: ${player.hero.id}.${key}`);
  }
  return Object.entries(fields).filter(([, field]) => field.visibility === 'public' ||
    (field.visibility === 'owner' && player.id === observerId)).map(([key, field]) => {
      const value = player.hero.state[key] ?? field.default;
      if (value != null && ((field.type === 'number' && !Number.isFinite(value)) ||
        (field.type === 'boolean' && typeof value !== 'boolean') ||
        (field.type === 'enum' && typeof value !== 'string'))) throw new Error(`Invalid state ${key}`);
      return { key, ...field, value };
    });
}
