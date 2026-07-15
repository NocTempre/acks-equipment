/* global game */
/**
 * The Loadout model — a derived, per-actor snapshot of what is equipped and
 * whether it is RAW-legal. Normalised from EITHER core `system.equipped` flags
 * OR the paper-doll `slots` flag (Phase 4). Consumed by enforcement, the
 * loadout Active Effect, the roll wrapper, and the public API.
 */
import { MODULE_ID, ITEM_FLAGS, ACTOR_FLAGS, SETTINGS } from "./constants.mjs";
import { STYLE } from "./config.mjs";
import { classifyWeapon, handCost, inferStyle, canOneHand } from "./profiles.mjs";
import { collectStringFlags, sumEffectModifiers } from "./effects.mjs";
import { EFFECT_DOMAINS } from "./constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC } from "./proficiency.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";

/** Violation type keys (for i18n + auto-resolve). */
export const VIOLATION = Object.freeze({
  HAND_OVERFLOW: "handOverflow",
  MULTIPLE_ARMOR: "multipleArmor",
  TOO_MANY_SHIELDS: "tooManyShields",
  SHIELD_NO_STYLE: "shieldNoStyle", // class lacks Weapon & Shield style → no benefit (advisory)
  WEAPON_NOT_PROFICIENT: "weaponNotProficient", // −1 attack, no style benefit (advisory; roll-time penalty in Phase 3)
  ARMOR_NOT_PROFICIENT: "armorNotProficient", // worn armour above class proficiency (advisory)
  STYLE_NOT_PROFICIENT: "styleNotProficient", // using an untrained fighting style (advisory)
  THIEF_SKILL_GATED: "thiefSkillGated", // Backstab/Hide/Pickpocket/Sneak blocked by armour/shield (advisory)
});

/** Base hand budget for an actor (2 + Four-Arms/anatomy effects + setting). */
export function handBudget(actor) {
  const base = Number(game.settings.get(MODULE_ID, SETTINGS.DEFAULT_HAND_BUDGET)) || 2;
  return base + sumEffectModifiers(actor, EFFECT_DOMAINS.HAND_BUDGET);
}

/** Fighting styles the actor is TRAINED in (RAW: single + missile mandatory). */
export function trainedStyles(actor) {
  // All style keys are stored lowercased for case-insensitive comparison
  // against `activeStyle.toLowerCase()`.
  const set = new Set(["single", "missile"]);
  const flag = actor.getFlag?.(MODULE_ID, "styles");
  if (typeof flag === "string") flag.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((s) => set.add(s));
  else if (Array.isArray(flag)) flag.forEach((s) => set.add(String(s).toLowerCase()));
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (!kind) set.add(style); // base training marker (already lowercased)
  }
  return set;
}

/** Fighting styles the actor is SPECIALIZED in (Fighting Style Specialization). */
export function specializedStyles(actor) {
  const set = new Set();
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (kind === "spec") set.add(style);
  }
  return set;
}

/** Is an armour item a helmet? (flag, else name heuristic matching core). */
function isHelmet(item) {
  if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET)) return true;
  return /helm/i.test(item.name ?? "");
}

/** Is an armour item a shield? */
function isShield(item) {
  return item.system?.type === "shield";
}

/**
 * Compute the full loadout for an actor from its equipped items.
 * @param {Actor} actor
 * @returns {Loadout}
 */
export function getLoadout(actor, opts = {}) {
  const budget = handBudget(actor);
  // `opts.overrides` (Map itemId→bool) lets enforcement simulate a pending
  // equip/unequip before it is committed.
  const isEq = (i) => (opts.overrides?.has(i.id) ? opts.overrides.get(i.id) : !!i.system?.equipped);
  const equippedWeapons = actor.items.filter((i) => i.type === "weapon" && isEq(i));
  const equippedArmor = actor.items.filter((i) => i.type === "armor" && isEq(i));

  const shields = equippedArmor.filter(isShield);
  const helmets = equippedArmor.filter((a) => !isShield(a) && isHelmet(a));
  const suits = equippedArmor.filter((a) => !isShield(a) && !isHelmet(a));

  // Classify weapons and assign hand costs (minimum, i.e. medium counts as 1).
  const wprof = weaponProficiency(actor);
  const weapons = equippedWeapons.map((item) => {
    const profile = classifyWeapon(item);
    const wornHand = item.getFlag?.(MODULE_ID, ITEM_FLAGS.WORN_HAND) ?? null;
    return {
      item,
      profile,
      wornHand,
      handsMin: handCost(profile, { twoHanded: false }),
      wieldTwoHanded: false,
      melee: profile.melee,
      missile: profile.missile,
      proficient: isWeaponProficient(actor, profile, wprof),
    };
  });

  // Only a shield carried IN HAND costs a hand; a strapped one (JJ variant
  // overlay) rides the back or front and leaves both hands free.
  const handShields = shields.filter(occupiesHand);
  let handsUsed = weapons.reduce((n, w) => n + w.handsMin, 0) + handShields.length;

  // A lone medium/large melee weapon with spare hands and no shield in hand is
  // wielded two-handed (RAW 1d8/1d10). Mark it so damage + style reflect that.
  if (weapons.length === 1 && !handShields.length && weapons[0].melee) {
    const w = weapons[0];
    const twoH = handCost(w.profile, { twoHanded: true });
    if (twoH === 2 && budget >= 2) {
      w.wieldTwoHanded = true;
      handsUsed = 2;
    }
  }

  const hasShield = handShields.length > 0; // only a shield in hand forms Weapon & Shield
  const overrideStyle = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.ACTIVE_STYLE) ?? null;
  const activeStyle = overrideStyle ?? inferStyle(weapons, hasShield);

  const trained = trainedStyles(actor);
  const spec = specializedStyles(actor);
  const styleProficient = trained.has(activeStyle?.toLowerCase());

  // --- Violations -------------------------------------------------------
  const violations = [];
  if (handsUsed > budget) {
    // Auto-resolve candidates: shields first, then off-hand/extra weapons.
    const candidates = [
      ...shields.map((s) => ({ item: s, kind: "shield" })),
      ...weapons.slice().reverse().map((w) => ({ item: w.item, kind: "weapon" })),
    ];
    violations.push({
      type: VIOLATION.HAND_OVERFLOW,
      items: candidates.map((c) => c.item),
      detail: { handsUsed, budget },
    });
  }
  if (suits.length > 1) {
    violations.push({ type: VIOLATION.MULTIPLE_ARMOR, items: suits.slice(0, -1) }); // keep the last-equipped
  }
  if (shields.length > 2) {
    violations.push({ type: VIOLATION.TOO_MANY_SHIELDS, items: shields.slice(2) });
  }
  if (hasShield && !canUseShieldStyle(actor, trained)) {
    violations.push({ type: VIOLATION.SHIELD_NO_STYLE, items: shields, advisory: true });
  }

  // --- Proficiency advisories (never blocking; roll penalties land in Phase 3) ---
  const armor = suits[suits.length - 1] ?? null;
  const amax = armorMax(actor);
  const armorProficient = armor ? isArmorProficient(actor, armor, amax) : true;
  const nonProfWeapons = weapons.filter((w) => !w.proficient);
  if (nonProfWeapons.length) {
    violations.push({ type: VIOLATION.WEAPON_NOT_PROFICIENT, items: nonProfWeapons.map((w) => w.item), advisory: true });
  }
  if (armor && !armorProficient) {
    violations.push({ type: VIOLATION.ARMOR_NOT_PROFICIENT, items: [armor], advisory: true, detail: { max: amax } });
  }
  if (weapons.length && !styleProficient) {
    violations.push({ type: VIOLATION.STYLE_NOT_PROFICIENT, items: weapons.map((w) => w.item), advisory: true, detail: { style: activeStyle } });
  }
  const thiefGated = thiefSkillsGated({ armor, shield: shields[0] ?? null });
  if (thiefGated) {
    violations.push({ type: VIOLATION.THIEF_SKILL_GATED, items: [armor, shields[0]].filter(Boolean), advisory: true });
  }

  return {
    actorId: actor.id,
    handBudget: budget,
    handsUsed,
    handsFree: Math.max(0, budget - handsUsed),
    weapons,
    armor,
    armorProficient,
    armorMax: amax,
    extraArmor: suits.slice(0, -1),
    shields,
    handShields,
    shield: handShields[0] ?? shields[0] ?? null,
    helmet: helmets[0] ?? null,
    hasHelmet: helmets.length > 0,
    activeStyle,
    trainedStyles: trained,
    specStyles: spec,
    styleProficient,
    thiefSkillsGated: thiefGated,
    condAC: swashbucklingAC(actor, { armor }),
    violations,
    legal: violations.every((v) => v.advisory),
  };
}

/** Does the actor have the Weapon & Shield style (so shields grant AC)? */
function canUseShieldStyle(actor, trained = trainedStyles(actor)) {
  return trained.has(STYLE.WEAPON_SHIELD.toLowerCase());
}

/**
 * @typedef {object} Loadout
 * @property {number} handBudget
 * @property {number} handsUsed
 * @property {number} handsFree
 * @property {object[]} weapons
 * @property {object|null} armor
 * @property {object[]} shields
 * @property {object|null} shield
 * @property {object|null} helmet
 * @property {string} activeStyle
 * @property {Set<string>} trainedStyles
 * @property {Set<string>} specStyles
 * @property {boolean} styleProficient
 * @property {{type,items,advisory?,detail?}[]} violations
 * @property {boolean} legal
 */
