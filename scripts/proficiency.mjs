/* global game */
/**
 * Proficiency resolution — weapon, armour, and thief-skill armour gates.
 *
 * RAW proficiency comes from a character's class, which the core system does not
 * store. So the actor carries a per-actor proficiency profile via flags
 * (permissive defaults until a GM narrows them), extended by data-driven effect
 * flags from proficiency items (Martial Training, Armour Training):
 *   flags.acks-equipment.weaponProficiency  "all" | CSV of categories/weapon keys
 *   flags.acks-equipment.armorMax           unarmored|veryLight|light|medium|heavy
 *   flags.acks-equipment.martialWeapons     (effect) CSV of added weapon categories
 *   flags.acks-equipment.armorTraining      (effect) integer categories added
 */
import { MODULE_ID, ACTOR_FLAGS, EFFECT_DOMAINS } from "./constants.mjs";
import { ARMOR_LADDER, ARMOR_GATED_SKILLS, ARMOR_GATE_MAX, normalizeName } from "./config.mjs";
import { collectStringFlags, sumEffectModifiers, hasEffectFlag } from "./effects.mjs";

/** Ladder index of an armour category (higher = heavier); -1 if unknown. */
export function armorRank(category) {
  return ARMOR_LADDER.indexOf(category);
}

/** Raise an armour category up the ladder by `steps`, clamped. */
function raiseCategory(category, steps) {
  const i = armorRank(category);
  if (i < 0) return category;
  return ARMOR_LADDER[Math.min(ARMOR_LADDER.length - 1, i + Math.max(0, steps))];
}

/**
 * The actor's resolved weapon proficiency.
 * @returns {{all:boolean, categories:Set<string>, weapons:Set<string>}}
 */
export function weaponProficiency(actor) {
  const flag = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.WEAPON_PROF);
  const martial = collectStringFlags(actor, EFFECT_DOMAINS.MARTIAL_WEAPONS); // category tokens
  if (flag == null || flag === "all") {
    return { all: martial.size === 0, categories: martial, weapons: new Set() };
  }
  const tokens = String(flag)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const categories = new Set(martial);
  const weapons = new Set();
  // A token is a category if it matches a known category token; else a weapon key.
  const CATS = new Set(["axe", "bow", "crossbow", "flailhammermace", "sworddagger", "spearpolearm", "other"]);
  for (const t of tokens) {
    if (CATS.has(t)) categories.add(t);
    else weapons.add(normalizeName(t));
  }
  return { all: false, categories, weapons };
}

/** Is a weapon (resolved profile) one the actor is proficient with? */
export function isWeaponProficient(actor, profile, prof = weaponProficiency(actor)) {
  if (prof.all) return true;
  if (profile.key && prof.weapons.has(profile.key)) return true;
  return prof.categories.has(String(profile.cat).toLowerCase());
}

/** Highest armour category the actor may wear without penalty (+ Armour Training). */
export function armorMax(actor) {
  const base = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.ARMOR_MAX) ?? "heavy";
  const training = sumEffectModifiers(actor, EFFECT_DOMAINS.ARMOR_TRAINING);
  return raiseCategory(base, training);
}

/** Is a worn armour item within the actor's proficiency? Shields are style-gated. */
export function isArmorProficient(actor, armorItem, max = armorMax(actor)) {
  const cat = armorItem?.system?.type;
  if (!cat || cat === "shield") return true;
  const r = armorRank(cat);
  return r < 0 ? true : r <= armorRank(max);
}

/**
 * Thief-skill armour gate (JJ p. 292): Backstabbing, Hiding, Pickpocketing, and
 * Sneaking require ≤ leather (light) armour and no shield.
 * @returns {boolean} true if the gated skills are currently BLOCKED.
 */
export function thiefSkillsGated(loadout) {
  const armorCat = loadout?.armor?.system?.type ?? "unarmored";
  const overLight = armorRank(armorCat) > armorRank(ARMOR_GATE_MAX);
  const hasShield = !!loadout?.shield;
  return overLight || hasShield;
}

/** Is a named skill/ability subject to the armour gate? */
export function isArmorGatedSkill(name) {
  const n = normalizeName(name);
  return ARMOR_GATED_SKILLS.some((s) => n.includes(normalizeName(s)));
}

/**
 * Swashbuckling AC bonus (RR p. 117): +1 (→+2 at L7, +3 at L13) while wearing
 * ≤ light armour and carrying ≤ 5 stone. 0 unless the actor has the proficiency.
 */
export function swashbucklingAC(actor, loadout) {
  if (!hasEffectFlag(actor, EFFECT_DOMAINS.SWASHBUCKLING)) return 0;
  const armorCat = loadout?.armor?.system?.type ?? "unarmored";
  const enc = Number(actor.system?.encumbrance?.value ?? 0);
  if (armorRank(armorCat) > armorRank("light") || enc > 5) return 0;
  const level = Number(actor.system?.details?.level ?? 1);
  return level >= 13 ? 3 : level >= 7 ? 2 : 1;
}
