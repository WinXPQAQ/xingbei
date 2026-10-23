import { assassinAi } from "../../../assassin/ai.js";
import { magicSwordsmanAi } from "../../../magic-swordsman/ai.js";
import { adjudicatorAi } from "../../../adjudicator/ai.js";
import { sageAi } from "../../../sage/ai.js";
import { prayerAi } from "../../../prayer/ai.js";
import { heroicPuppetAi } from "../../../heroic-puppet/ai.js";

const profiles = [assassinAi, magicSwordsmanAi, adjudicatorAi, sageAi, prayerAi, heroicPuppetAi];
const byHero = new Map(profiles.map((profile) => [profile.id, profile]));
const decisions = new Map(profiles.flatMap((profile) => Object.entries(profile.decisions ?? {})));
const empty = Object.freeze({});
export const heroIds = new Set(byHero.keys());
export const sharedDecisionSkills = new Set(profiles.flatMap((profile) => profile.sharedDecisionSkills ?? []));
export const heroAi = (id) => byHero.get(id) ?? empty;
export const skillDecision = (id) => decisions.get(id);
