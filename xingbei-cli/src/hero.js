import { NobleLady } from "./heroes/noble-lady/index.js";
import { HeadMaid } from "./heroes/head-maid/index.js";
import { BarrierMaster } from "./heroes/barrier-master/index.js";
import { Mystic } from "./heroes/mystic/index.js";
import { Defiler } from "./heroes/defiler/index.js";
import { SwordWitch } from "./heroes/sword-witch/index.js";
import { ButterflyDancer } from "./heroes/butterfly-dancer/index.js";
import { BattleMage } from "./heroes/battle-mage/index.js";
import { StarfallWitch } from "./heroes/starfall-witch/index.js";
import { Inquisitor } from "./heroes/inquisitor/index.js";
import { WitchHunter } from "./heroes/witch-hunter/index.js";
import { Templar } from "./heroes/templar/index.js";
import { ElfArcher } from "./heroes/elf-archer/index.js";
import { YinYangMaster } from "./heroes/yin-yang-master/index.js";
import { SoulWarlock } from "./heroes/soul-warlock/index.js";
import { BloodWitch } from "./heroes/blood-witch/index.js";
import { MoonGoddess } from "./heroes/moon-goddess/index.js";
import { HolyArcher } from "./heroes/holy-archer/index.js";
import { TalismanMaster } from "./heroes/talisman-master/index.js";
import { SwordEmperor } from "./heroes/sword-emperor/index.js";
import { MagicArcher } from "./heroes/magic-archer/index.js";
import { AzureFlameWitch } from "./heroes/azure-flame-witch/index.js";
import { BloodSwordSpirit } from "./heroes/blood-sword-spirit/index.js";
import { BeastWarrior } from "./heroes/beast-warrior/index.js";
import { Adventurer } from "./heroes/adventurer/index.js";
import { Fighter } from "./heroes/fighter/index.js";
import { Brave } from "./heroes/brave/index.js";
import { RedLotusKnight } from "./heroes/red-lotus-knight/index.js";
import { MagicLancer } from "./heroes/magic-lancer/index.js";
import { Bard } from "./heroes/bard/index.js";
import { HeroicPuppet } from "./heroes/heroic-puppet/index.js";
import { Prayer } from "./heroes/prayer/index.js";
import { Sage } from "./heroes/sage/index.js";
import { Adjudicator } from "./heroes/adjudicator/index.js";
import { MagicSwordsman } from "./heroes/magic-swordsman/index.js";
import { Assassin } from "./heroes/assassin/index.js";
import { Saint } from "./heroes/saint/index.js";
import { HolyLancer } from "./heroes/holy-lancer/index.js";
import { PlagueMage } from "./heroes/plague-mage/index.js";
import { Elementalist } from "./heroes/elementalist/index.js";
import { Valkyrie } from "./heroes/valkyrie/index.js";
import { MagicalGirl } from "./heroes/magical-girl/index.js";
import { Priest } from "./heroes/priest/index.js";
import { GuardianAngel } from "./heroes/guardian-angel/index.js";
import { Sealer } from "./heroes/sealer/index.js";
import { Marksman } from "./heroes/marksman/index.js";
import { WindSwordmaster } from "./heroes/wind-swordmaster/index.js";
import { Berserker } from "./heroes/berserker/index.js";
import { Hero } from "./hero-base.js";
export { Hero } from "./hero-base.js";
const definitions = [
  ["berserker", "狂战士"], ["magicalGirl", "魔法少女"], ["bard", "吟游诗人"],
  ["swordEmperor", "剑帝"], ["priest", "神官"], ["assassin", "暗杀者"],
];
export const HERO_DEFINITIONS = {
  nobleLady: { name: "矜贵之女", HeroClass: NobleLady },
  headMaid: { name: "女仆长", HeroClass: HeadMaid },
  barrierMaster: { name: "结界师", HeroClass: BarrierMaster },
  mystic: { name: "神秘学者", HeroClass: Mystic },
  defiler: { name: "染污者", HeroClass: Defiler },
  swordWitch: { name: "剑之魔女", HeroClass: SwordWitch },

  butterflyDancer: { name: "蝶舞者", HeroClass: ButterflyDancer },
  battleMage: { name: "战斗法师", HeroClass: BattleMage },
  starfallWitch: { name: "星坠女巫", HeroClass: StarfallWitch },
  inquisitor: { name: "圣庭检察士", HeroClass: Inquisitor },
  witchHunter: { name: "猎巫人", HeroClass: WitchHunter },
  templar: { name: "圣殿骑士", HeroClass: Templar },

  elfArcher: { name: "精灵射手", HeroClass: ElfArcher },
  yinYangMaster: { name: "阴阳师", HeroClass: YinYangMaster },
  soulWarlock: { name: "灵魂术士", HeroClass: SoulWarlock },
  bloodWitch: { name: "血之巫女", HeroClass: BloodWitch },
  moonGoddess: { name: "月之女神", HeroClass: MoonGoddess },
  holyArcher: { name: "圣弓", HeroClass: HolyArcher },

  talismanMaster: { name: "灵符师", HeroClass: TalismanMaster },
  swordEmperor: { name: "剑帝", HeroClass: SwordEmperor },
  magicArcher: { name: "魔弓", HeroClass: MagicArcher },
  azureFlameWitch: { name: "苍炎魔女", HeroClass: AzureFlameWitch },
  bloodSwordSpirit: { name: "血色剑灵", HeroClass: BloodSwordSpirit },
  beastWarrior: { name: "兽灵武士", HeroClass: BeastWarrior },

  adventurer: { name: "冒险家", HeroClass: Adventurer },
  fighter: { name: "格斗家", HeroClass: Fighter },
  brave: { name: "勇者", HeroClass: Brave },
  redLotusKnight: { name: "红莲骑士", HeroClass: RedLotusKnight },
  magicLancer: { name: "魔枪", HeroClass: MagicLancer },
  bard: { name: "吟游诗人", HeroClass: Bard },

  assassin: { name: "暗杀者", HeroClass: Assassin },
  magicSwordsman: { name: "魔剑士", HeroClass: MagicSwordsman },
  adjudicator: { name: "仲裁者", HeroClass: Adjudicator },
  sage: { name: "贤者", HeroClass: Sage },
  prayer: { name: "祈祷师", HeroClass: Prayer },
  heroicPuppet: { name: "英灵人形", HeroClass: HeroicPuppet },
  saint: { name: "圣女", HeroClass: Saint },
  holyLancer: { name: "圣枪骑士", HeroClass: HolyLancer },
  plagueMage: { name: "瘟疫法师", HeroClass: PlagueMage },
  elementalist: { name: "元素师", HeroClass: Elementalist },
  valkyrie: { name: "女武神", HeroClass: Valkyrie },
  magicalGirl: { name: "魔法少女", HeroClass: MagicalGirl },
  priest: { name: "神官", HeroClass: Priest },
  guardianAngel: { name: "守护天使", HeroClass: GuardianAngel },
  sealer: { name: "封印师", HeroClass: Sealer },
  marksman: { name: "神箭手", HeroClass: Marksman },
  windSwordmaster: { name: "风之剑圣", HeroClass: WindSwordmaster },
  berserker: { name: "狂战士", HeroClass: Berserker },
};
export function createHero(id, enabled = true) {
  const definition = HERO_DEFINITIONS[id];
  const name = definition?.name ?? definitions.find(entry => entry[0] === id)?.[1] ?? id;
  return definition ? new definition.HeroClass(enabled) : new Hero({ id, name });
}
export const DEFAULT_HERO_IDS = ["berserker", "windSwordmaster", "marksman", "sealer", "guardianAngel", "priest"];
export function createDefaultHero(seat, enabled = true) { return createHero(enabled ? DEFAULT_HERO_IDS[seat] : definitions[seat][0], enabled); }

export function getAvailableHeroes() {
  const ids = [...new Set([...DEFAULT_HERO_IDS, ...Object.keys(HERO_DEFINITIONS)])];
  return ids.map(id => ({ id, name: HERO_DEFINITIONS[id].name }));
}
export const WAVE_THREE_HERO_IDS = ["assassin", "magicSwordsman", "adjudicator", "sage", "prayer", "heroicPuppet"];
export const WAVE_TWO_HERO_IDS = ["saint", "holyLancer", "plagueMage", "elementalist", "valkyrie", "magicalGirl"];
export function createHeroRoster(playerHeroId, playerSeat = 0, initialRoster = DEFAULT_HERO_IDS) {
  if (initialRoster.length !== 6 || initialRoster.some(id => !Object.hasOwn(HERO_DEFINITIONS, id))) throw new Error("无效的测试阵容");
  if (!Object.hasOwn(HERO_DEFINITIONS, playerHeroId)) throw new Error("角色尚未实现或不存在");
  if (!Number.isInteger(playerSeat) || playerSeat < 0 || playerSeat >= DEFAULT_HERO_IDS.length) throw new Error("无效的玩家座位");
  const roster = [...initialRoster], previousSeat = roster.indexOf(playerHeroId);
  if (previousSeat >= 0) [roster[playerSeat], roster[previousSeat]] = [roster[previousSeat], roster[playerSeat]];
  else roster[playerSeat] = playerHeroId;
  return roster;
}

export const WAVE_FOUR_HERO_IDS = ["adventurer", "fighter", "brave", "redLotusKnight", "magicLancer", "bard"];

export const WAVE_FIVE_HERO_IDS = ["talismanMaster", "swordEmperor", "magicArcher", "azureFlameWitch", "bloodSwordSpirit", "beastWarrior"];

export const WAVE_SIX_HERO_IDS = ["elfArcher", "yinYangMaster", "soulWarlock", "bloodWitch", "moonGoddess", "holyArcher"];

export const WAVE_SEVEN_HERO_IDS = ["butterflyDancer", "battleMage", "starfallWitch", "inquisitor", "witchHunter", "templar"];

export const WAVE_EIGHT_HERO_IDS = ["nobleLady", "headMaid", "barrierMaster", "mystic", "defiler", "swordWitch"];
