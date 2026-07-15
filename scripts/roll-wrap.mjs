/* global libWrapper, CONFIG, Hooks, foundry */
/**
 * Combat-roll integration (Phase 3).
 *
 * Always-on, loadout-level modifiers (fighting-style specialization, Combat
 * Reflexes, Swashbuckling) are already folded into core's own `system.*.mod`
 * fields by the managed loadout Active Effect — no patch needed. What CANNOT be
 * expressed as a static actor modifier is *per-weapon*, so it is injected here:
 *
 *   - non-proficiency −1 (weapon OR fighting style untrained; RAW, applied once)
 *   - Weapon Finesse: DEX instead of STR on tiny/small/medium melee attacks
 *   - two-handed damage upsize for medium weapons wielded in both hands (1d6→1d8)
 *
 * Technique (deliberately non-invasive): `AcksItem#rollWeapon` passes
 * `item: this.toObject()` — a plain throwaway object — and `AcksActor#rollAttack`
 * only reads `item.system.bonus` (pushed onto the attack parts) and
 * `item.system.damage` (pushed onto the damage parts). So we hand `wrapped()` a
 * copy of that plain object with those two fields adjusted. Nothing mutates the
 * real Item, and core's roll pipeline is untouched.
 *
 * HANDOFF: this wrap exists only because core builds its parts internally and
 * fires no pre-roll hook. If the system ever exposes
 * `acks.preRollAttack(actor, item, parts, ctx)`, this file can be deleted and
 * the same modifiers contributed through it. We fire our own
 * `acksEquipment.preRollAttack` with the computed breakdown in the meantime.
 */
import { MODULE_ID, HOOKS, EFFECT_DOMAINS } from "./constants.mjs";
import { SIZE } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { classifyWeapon } from "./profiles.mjs";
import { isWeaponProficient } from "./proficiency.mjs";
import { hasEffectFlag } from "./effects.mjs";
import { encumbranceDelta6 } from "./containers.mjs";

/** Sizes eligible for Weapon Finesse (RR p. 121). */
const FINESSE_SIZES = [SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM];

/**
 * Compute the per-weapon RAW modifiers for one attack.
 * @returns {{bonusDelta:number, damage:string|null, notes:string[]}|null}
 */
export function computeAttackMods(actor, attData, options = {}) {
  if (actor?.type !== "character") return null; // monster natural attacks are not proficiency-gated
  const itemId = attData?.item?._id;
  if (!itemId) return null;
  const item = actor.items.get(itemId);
  if (item?.type !== "weapon") return null;

  const profile = classifyWeapon(item);
  const loadout = getLoadout(actor);
  const entry = loadout.weapons.find((w) => w.item.id === itemId);
  const notes = [];
  let bonusDelta = 0;
  let damage = null;

  // Non-proficiency: RAW requires BOTH weapon and fighting-style proficiency;
  // lacking either imposes the penalty once (not twice).
  const weaponProficient = entry ? entry.proficient : isWeaponProficient(actor, profile);
  if (!weaponProficient || !loadout.styleProficient) {
    bonusDelta -= 1;
    notes.push(!weaponProficient ? "non-proficient weapon (−1)" : `untrained ${loadout.activeStyle} style (−1)`);
  }

  // Weapon Finesse — DEX replaces STR on the attack throw. Core pushed str.mod
  // for melee, so contribute the difference.
  if (options.type === "melee" && FINESSE_SIZES.includes(profile.size) && hasEffectFlag(actor, EFFECT_DOMAINS.FINESSE)) {
    const str = Number(actor.system?.scores?.str?.mod ?? 0);
    const dex = Number(actor.system?.scores?.dex?.mod ?? 0);
    if (dex !== str) {
      bonusDelta += dex - str;
      notes.push(`Weapon Finesse (DEX ${dex >= 0 ? "+" : ""}${dex} instead of STR ${str >= 0 ? "+" : ""}${str})`);
    }
  }

  // Medium weapon wielded two-handed deals its larger die (RR p. 299).
  if (options.type === "melee" && entry?.wieldTwoHanded && profile.damage2h) {
    damage = profile.damage2h;
    notes.push(`two-handed grip (${profile.damage2h})`);
  }

  if (!bonusDelta && !damage) return null;
  return { bonusDelta, damage, notes };
}

/** Apply the modifiers to a COPY of the throwaway plain item object. */
function applyMods(attData, mods) {
  // attData.item is a plain object (Item#toObject); attData.roll may hold live
  // Documents (targets), so clone only the item — never the whole attData.
  const item = foundry.utils.deepClone(attData.item);
  item.system.bonus = Number(item.system.bonus ?? 0) + mods.bonusDelta;
  if (mods.damage) item.system.damage = mods.damage;
  return { ...attData, item };
}

/** WRAPPER around AcksActor#rollAttack. Fails safe: any error → core's roll. */
function onRollAttack(wrapped, attData, options = {}) {
  try {
    const mods = computeAttackMods(this, attData, options);
    if (mods) {
      Hooks.callAll(HOOKS.PRE_ROLL_ATTACK, this, attData.item, mods, { attData, options });
      console.debug(`${MODULE_ID} | attack mods for ${attData.item?.name}:`, mods.notes.join("; "));
      attData = applyMods(attData, mods);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | attack-roll wrap failed; using the unmodified core roll`, err);
  }
  return wrapped(attData, options);
}

/**
 * WRAPPER around AcksActor#computeEncumbrance.
 *
 * FLAGGED: this wraps a core method that acks-formation depends on (it reads the
 * resulting system.encumbrance / movementacks for party speed). It is an
 * ENHANCE, not a replacement — core's own sum runs untouched and we adjust the
 * total afterwards, so formation keeps reading one consistent number and the two
 * modules cannot disagree. Only RAW rules a flat sum gets wrong are corrected
 * (adventurer's harness, bowquiver); with no containers in play the delta is 0
 * and this is a pass-through.
 *
 * Core calls _calculateMovement() at the END of computeEncumbrance, so any
 * adjustment must recompute movement or speed would reflect the pre-correction
 * weight.
 *
 * HANDOFF: a core `system.encumbrance.mod` field (the way `aac.mod` lets us
 * correct AC without a patch) would let this wrap be deleted entirely.
 */
function onComputeEncumbrance(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    if (this.type !== "character") return result;
    const delta6 = encumbranceDelta6(this);
    if (!delta6) return result; // common case: nothing RAW-specific applies
    const enc = this.system.encumbrance;
    const value6 = Math.max(0, Number(enc.value6 ?? 0) + delta6);
    const stones = value6 / 6;
    const max = Number(enc.max ?? 0) || 1;
    this.system.encumbrance = {
      ...enc,
      value6,
      value: Math.round(stones),
      pct: Math.clamp ? Math.clamp((stones / max) * 100, 0, 100) : Math.min(100, Math.max(0, (stones / max) * 100)),
      encumbered: stones > max,
    };
    // Core computed movement from the pre-correction weight — redo it.
    if (this.system.config?.movementAuto) this._calculateMovement();
  } catch (err) {
    console.error(`${MODULE_ID} | encumbrance wrap failed; core's value stands`, err);
  }
  return result;
}

export function registerRollWrap() {
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollAttack", onRollAttack, "WRAPPER");
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.computeEncumbrance", onComputeEncumbrance, "WRAPPER");
  console.debug(`${MODULE_ID} | attack-roll and encumbrance wrappers registered.`);
  void CONFIG;
}
