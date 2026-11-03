import mischiefGirl from "../../src/heroes/mischief-girl/observation.js";
import holyAdjudicator from "../../src/heroes/holy-adjudicator/observation.js";
import orchestraLeader from "../../src/heroes/orchestra-leader/observation.js";
import swordChild from "../../src/heroes/sword-child/observation.js";
import slothGirl from "../../src/heroes/sloth-girl/observation.js";
import spiritTide from "../../src/heroes/spirit-tide/observation.js";
import gluttonousGirl from "../../src/heroes/gluttonous-girl/observation.js";
import trickAdventurer from "../../src/heroes/trick-adventurer/observation.js";
import primalArcher from "../../src/heroes/primal-archer/observation.js";
import trickHolyArcher from "../../src/heroes/trick-holy-archer/observation.js";
import enviousGirl from "../../src/heroes/envious-girl/observation.js";
import ranger from "../../src/heroes/ranger/observation.js";
import magicArcherEX from "../../src/heroes/magic-archer-ex/observation.js";
import apprenticeProducer from "../../src/heroes/apprentice-producer/observation.js";
import delinquentGirl from "../../src/heroes/delinquent-girl/observation.js";
import curseTalisman from "../../src/heroes/curse-talisman/observation.js";
import greedyGirl from "../../src/heroes/greedy-girl/observation.js";
import holidayMage from "../../src/heroes/holiday-mage/observation.js";
import godEater from "../../src/heroes/god-eater/observation.js";
import lawgiver from '../../src/heroes/lawgiver/observation.js';
import cardinal from '../../src/heroes/cardinal/observation.js';
import chronicler from '../../src/heroes/chronicler/observation.js';
import missionary from '../../src/heroes/missionary/observation.js';
import heretic from '../../src/heroes/heretic/observation.js';
import nobleLady from '../../src/heroes/noble-lady/observation.js';
import headMaid from '../../src/heroes/head-maid/observation.js';
import barrierMaster from '../../src/heroes/barrier-master/observation.js';
import mystic from '../../src/heroes/mystic/observation.js';
import defiler from '../../src/heroes/defiler/observation.js';
import swordWitch from '../../src/heroes/sword-witch/observation.js';
import butterflyDancer from '../../src/heroes/butterfly-dancer/observation.js';
import battleMage from '../../src/heroes/battle-mage/observation.js';
import starfallWitch from '../../src/heroes/starfall-witch/observation.js';
import inquisitor from '../../src/heroes/inquisitor/observation.js';
import witchHunter from '../../src/heroes/witch-hunter/observation.js';
import templar from '../../src/heroes/templar/observation.js';
import elfArcher from '../../src/heroes/elf-archer/observation.js';
import yinYangMaster from '../../src/heroes/yin-yang-master/observation.js';
import soulWarlock from '../../src/heroes/soul-warlock/observation.js';
import bloodWitch from '../../src/heroes/blood-witch/observation.js';
import moonGoddess from '../../src/heroes/moon-goddess/observation.js';
import holyArcher from '../../src/heroes/holy-archer/observation.js';
import talismanMaster from '../../src/heroes/talisman-master/observation.js';
import swordEmperor from '../../src/heroes/sword-emperor/observation.js';
import magicArcher from '../../src/heroes/magic-archer/observation.js';
import azureFlameWitch from '../../src/heroes/azure-flame-witch/observation.js';
import bloodSwordSpirit from '../../src/heroes/blood-sword-spirit/observation.js';
import beastWarrior from '../../src/heroes/beast-warrior/observation.js';
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

export const heroFields = Object.freeze({mischiefGirl,holyAdjudicator,orchestraLeader,swordChild,slothGirl,spiritTide,gluttonousGirl,trickAdventurer,primalArcher,trickHolyArcher,enviousGirl,ranger,magicArcherEX,apprenticeProducer,delinquentGirl,curseTalisman,greedyGirl,holidayMage,godEater,lawgiver,cardinal,chronicler,missionary,heretic,nobleLady,headMaid,barrierMaster,mystic,defiler,swordWitch,butterflyDancer,battleMage,starfallWitch,inquisitor,witchHunter,templar,elfArcher,yinYangMaster,soulWarlock,bloodWitch,moonGoddess,holyArcher,talismanMaster,swordEmperor,magicArcher,azureFlameWitch,bloodSwordSpirit,beastWarrior,adventurer,fighter,brave,redLotusKnight,magicLancer,bard,berserker,windSwordmaster,marksman,sealer,guardianAngel,priest,saint,holyLancer,plagueMage,elementalist,valkyrie,magicalGirl,assassin,magicSwordsman,adjudicator,sage,prayer,heroicPuppet});
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
