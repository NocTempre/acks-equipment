/**
 * Shared identifiers for acks-equipment.
 *
 * Design note (mirrors acks-henchmen): mechanics live as Active Effect changes
 * keyed `flags.acks-equipment.<domain>` on `ability`/`weapon`/`armor` items, not
 * as hardcoded name lists. The effect collector in effects.mjs reads them.
 */

export const MODULE_ID = "acks-equipment";

/** Active Effect change-key prefix for this module's data-driven modifiers. */
export const EFFECT_PREFIX = `flags.${MODULE_ID}.`;

/**
 * Effect domains — the `<domain>` in `flags.acks-equipment.<domain>` change keys.
 * Numeric domains sum; string/CSV domains collect; boolean-ish domains test
 * presence. See docs/MODEL.md for the full contract.
 */
export const EFFECT_DOMAINS = Object.freeze({
  // Numeric, always-on → folded into the core `system.*.mod` fields.
  HAND_BUDGET: "handBudget", // raises the base 2-hand budget (Four Arms, monster anatomy)
  STYLE_AC: "styleAC", // Weapon & Shield spec, variant-shield AC, Swashbuckling/Blade-Dancing
  STYLE_INIT: "styleInit", // Single-weapon spec, Combat Reflexes
  STYLE_ATTACK_MELEE: "styleAttackMelee", // Dual spec, slayer flats
  STYLE_ATTACK_MISSILE: "styleAttackMissile", // Missile spec
  STYLE_DAMAGE_MELEE: "styleDamageMelee", // Two-handed spec
  MAX_CLEAVES: "maxCleaves", // Combat Ferocity
  // String / CSV domains.
  WEAPON_FOCUS: "weaponFocus", // CSV of Weapon Focus categories
  SLAYER: "slayer", // CSV of "group:bonus" slayer entries (goblin, vermin)
  MARTIAL_WEAPONS: "martialWeapons", // CSV weapon categories added to proficiency
  WEAPON_PROF: "weaponProf", // CSV grant tokens from class training (JJ p. 290 chunks)
  ARMOR_PROF: "armourProficiency", // highest armour category granted by class training
  ARMOR_TRAINING: "armorTraining", // integer: armour categories added above class
  MANEUVER_TRICKERY: "maneuverTrickery", // CSV of Combat Trickery maneuvers
  // Boolean-ish domains (presence tested).
  FINESSE: "finesse", // Weapon Finesse
  PRECISE_SHOOTING: "preciseShooting",
  SNIPING: "sniping",
  AMBUSHING: "ambushing",
  SKIRMISHING: "skirmishing",
  UNARMED_FIGHTING: "unarmedFighting",
  BLIND_FIGHTING: "blindFighting",
  MOUNTED_COMBAT: "mountedCombat",
  RIDING: "riding",
  RUNNING: "running", // +30' base speed (≤ medium armour, ≤7 st) — consumed by movement modules (formation), not this one
  BERSERKERGANG: "berserkergang",
  FREE_SWAP: "freeSwap", // Fighting Style Specialization free draw/sheath/ready
  NO_SHIELD_BENEFIT: "noShieldBenefit", // class lacks Weapon & Shield style
  STYLE_PROFICIENT: "styleProficient", // CSV of fighting styles the actor is trained in
  SWASHBUCKLING: "swashbuckling", // conditional AC: <= light armour & <= 5 st (RR p. 117)
});

/** Per-item override / annotation flags (on weapon & armor items). */
export const ITEM_FLAGS = Object.freeze({
  SIZE: "size", // "tiny" | "small" | "medium" | "large"
  HANDS: "hands", // explicit hand cost override (number)
  STYLE: "style", // required fighting style key
  DAMAGE_TYPE: "damageType", // aligns with acks-monsters DAMAGE_TYPES
  HANDY: "handy",
  THROWN: "thrown",
  SHIELD_VARIANT: "shieldVariant", // JJ overlay: buckler|auxiliary|crescent|heater|kite|phalanx
  STRAP: "strap", // JJ overlay: "hand" | "back" | "front"
  MASTERWORK: "masterwork", // {toHit,toDamage,acWeight,ac}
  HELMET: "helmet", // "light" | "heavy"
  MATERIAL: "material", // primary material, for the item-loss materials table
  LOSS_CATEGORY: "lossCategory", // explicit position in the item-loss order
  LAYER: "layer", // clothing: "over" | "under" (armour)
  CONTAINER: "container", // {capacity: <stone>} — marks an item as a container
  CONTAINED_IN: "containedIn", // id of the container item this item is stored in
  HARNESS: "harness", // adventurer's harness: ignore 1 stone of ordinary gear
  BOWQUIVER: "bowquiver", // bowquiver: assembly counts as 2 items when loaded
  NAMED: "named", // {trueName, givenName, ladder[], unlocked, revealed, guesses{}}
  WORN_HAND: "hand", // set by paper-doll normalization: "main" | "off" | "mainOff"
});

/** Actor-level flags this module owns. */
export const ACTOR_FLAGS = Object.freeze({
  ACTIVE_STYLE: "activeStyle", // player's chosen style when two apply this round
  LAST_LOADOUT: "lastLoadoutHash", // dedupe guard for effect rebuilds
  STYLES: "styles", // CSV/array of fighting styles the actor is trained in (+ single,missile)
  WEAPON_PROF: "weaponProficiency", // "all" | CSV of categories/weapon keys the actor is proficient with
  ARMOR_MAX: "armorMax", // highest armour category the actor is proficient in (default heavy)
});

/** World/client settings keys. */
export const SETTINGS = Object.freeze({
  ENFORCE_MODE: "enforceMode", // "resolve" | "veto" | "advisory"
  ROLL_AUTOMATION: "rollAutomation", // wrap rollAttack/rollWeapon
  PAPERDOLL_STRATEGY: "paperdollStrategy", // "auto" | "paperdoll" | "fallback"
  PAPERDOLL_CONFIGURED: "paperdollConfigured", // internal: slot layout pushed once; never clobber GM edits
  DEFAULT_HAND_BUDGET: "defaultHandBudget",
  // Optional-rule overlays (RAW, off unless core-default).
  // NOTE: there is deliberately no masterwork overlay — RR p. 159 masterwork is
  // fully expressible in fields core already has (+1 hit = item.system.bonus,
  // +1 damage = a "1d6+1" damage string, +1 AC = aac.value, −1 stone = weight6),
  // so it needs data (see the equipment-samples pack), not automation.
  OVERLAY_SHIELD_VARIANTS: "overlayShieldVariants",
  OVERLAY_MANEUVERS: "overlayManeuvers",
  OVERLAY_ITEM_LOSS: "overlayItemLoss",
  OVERLAY_MOUNTED: "overlayMounted",
  OVERLAY_NAMED: "overlayNamed",
  OVERLAY_SCAVENGED: "overlayScavenged",
  OVERLAY_BEASTMAN: "overlayBeastman",
  OVERLAY_ENCLOSING_HELM: "overlayEnclosingHelm",
});

/** Enforcement behaviours. */
export const ENFORCE = Object.freeze({ RESOLVE: "resolve", VETO: "veto", ADVISORY: "advisory" });

/**
 * camelCase namespace for shared registries (globalThis, custom hooks,
 * Handlebars helpers) — the module id camelCased, per acks-module-template
 * docs/TOOLCHAIN.md §5b. Derived, never declared.
 */
export const NAMESPACE = MODULE_ID.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); // "acksEquipment"

/**
 * Custom hooks this module fires (consumable by sibling modules).
 * Named `acksEquipment.*` per the namespacing rule — note the validator's
 * static check only catches string literals passed to Hooks.call/callAll, so
 * these constants are on the honour system: keep the NAMESPACE prefix.
 */
export const HOOKS = Object.freeze({
  LOADOUT_CHANGED: `${NAMESPACE}.loadoutChanged`, // (actor, loadout)
  EQUIP_BLOCKED: `${NAMESPACE}.equipBlocked`, // (actor, item, {reason, resolution})
  PURCHASED: `${NAMESPACE}.purchased`, // (actor, item, cost)
  PRE_ROLL_ATTACK: `${NAMESPACE}.preRollAttack`, // (actor, item, mods, ctx) — also the name proposed for a core hook
});

/** The label of the module-managed loadout Active Effect on actors. */
export const LOADOUT_EFFECT_NAME = "Equipment Loadout";
export const LOADOUT_EFFECT_FLAG = "loadout"; // flags.acks-equipment.loadout = true marks our managed AE

/** Paper Doll module id + the flag/hook names it exposes. */
export const PAPERDOLL_ID = "fvtt-paper-doll-ui";
export const PAPERDOLL_HOOKS = Object.freeze({ EQUIP: "paper-doll-equip", SWAP: "paper-doll-swap" });
