/* global game, ui, CONFIG */
/**
 * Sheet-triggered equipment ACTIONS — the mutations the wear-bucket controls
 * invoke. Kept out of the render code (sheet.mjs) so each is unit-testable
 * against mock documents, and exposed on the module API for macros.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { MASTERWORK, SHIELD_VARIANTS } from "./config.mjs";
import { equipmentClass, classifyWeapon } from "./profiles.mjs";
import { consumeItem, roundsOf } from "./ammo.mjs";
import { tableFor, accumulate, needsReroll, toItemUpdates } from "./overlays/scavenged.mjs";

function notify(key, data) {
  const full = `ACKS-EQUIPMENT.action.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.info?.(msg);
}

/* -------------------------------------------------------------------------- */
/*  #1 Torch: ready one from the stack as a wieldable 1d4 light-weapon        */
/* -------------------------------------------------------------------------- */

/**
 * The item payload a readied torch becomes — a SINGLE weapon (core weapons have
 * no quantity field), 1d4, melee AND thrown (so core's range selector offers
 * both a swing and a hurl), flagged a light source. Pure, so a test can assert
 * the shape without Foundry.
 * @returns {object|null} null when `item` is not a preparable light-weapon.
 */
export function readiedWeaponData(item) {
  const klass = equipmentClass(item?.name ?? "");
  if (klass?.prepareAs !== "weapon") return null;
  return {
    name: item.name,
    type: "weapon",
    img: item.img,
    system: {
      damage: klass.damage || "1d4",
      melee: klass.melee ?? true,
      missile: klass.missile ?? true,
      bonus: 0,
      equipped: false,
      cost: Number(item.system?.cost ?? 0),
      weight: Number(item.system?.weight ?? 0),
      weight6: Number(item.system?.weight6 ?? 0),
    },
    flags: {
      [MODULE_ID]: { light: true, [ITEM_FLAGS.DAMAGE_TYPE]: klass.damageType || "fire", readied: true },
    },
  };
}

/**
 * Ready one torch from a carried stack: create the wieldable weapon-torch and
 * decrement the bundle (deleting the stack when the last one is drawn). No-op
 * with a warning when the stack is empty or the item is not a preparable light
 * source.
 * @returns {Promise<Item|null>} the created weapon, or null.
 */
export async function prepareTorch(actor, item) {
  const data = readiedWeaponData(item);
  if (!data) return null;
  if (roundsOf(item) < 1) {
    notify("noStock", { item: item.name });
    return null;
  }
  const [created] = (await actor?.createEmbeddedDocuments?.("Item", [data])) ?? [];
  const left = await consumeItem(item, 1);
  if (left <= 0) await item.delete?.();
  notify("readied", { item: item.name });
  return created ?? null;
}

/* -------------------------------------------------------------------------- */
/*  #3 Unarmed strike (RR p299: 1d3 nonlethal)                               */
/* -------------------------------------------------------------------------- */

/**
 * The synthetic weapon an unarmed strike rolls through. RR p299: unarmed strikes
 * deal 1d3 nonlethal damage; the Unarmed Fighting proficiency changes only
 * LETHALITY (lethal damage, and can hurt metal-armoured foes when brawling), not
 * the die — so there is one die here. Melee only.
 */
export function unarmedStrikeData() {
  return {
    name: game.i18n?.has?.("ACKS-EQUIPMENT.action.unarmed")
      ? game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")
      : "Unarmed Strike",
    type: "weapon",
    img: "icons/skills/melee/unarmed-punch-fist.webp",
    system: { damage: "1d3", melee: true, missile: false, bonus: 0, equipped: false },
  };
}

/**
 * Make an unarmed attack: build an UNSAVED weapon on the actor and run it
 * through core's own rollWeapon pipeline (targets, attack throw, damage). No
 * document is persisted — the item exists only for the roll — and because it has
 * no id, the attack-roll wrapper's per-item modifiers cleanly skip it.
 */
export function rollUnarmed(actor, options = {}) {
  if (!actor) return null;
  const cls = CONFIG?.Item?.documentClass;
  if (!cls) return null;
  const weapon = new cls(unarmedStrikeData(), { parent: actor });
  return weapon.rollWeapon(options);
}

/* -------------------------------------------------------------------------- */
/*  #3 Draw / sheathe — the equip toggle with a combat verb                   */
/* -------------------------------------------------------------------------- */

/** Sheathe a wielded weapon (unequip it). */
export async function sheatheItem(item) {
  return item?.update?.({ "system.equipped": false });
}
/** Draw a carried weapon (equip it). */
export async function drawItem(item) {
  return item?.update?.({ "system.equipped": true });
}

/* -------------------------------------------------------------------------- */
/*  #4 Masterwork (RR p159): stamp the tier onto core fields, reversibly       */
/* -------------------------------------------------------------------------- */

/** Append a flat +N/−N to a damage die string ("1d6" → "1d6 + 1"). */
export function addToDamage(damage, n) {
  const base = String(damage ?? "").trim();
  if (!n) return base;
  if (!base) return `${n > 0 ? "+" : "-"}${Math.abs(n)}`;
  return `${base} ${n > 0 ? "+" : "-"} ${Math.abs(n)}`;
}

/** The masterwork tiers that apply to a given item type (drives the picker). */
export function masterworkTiersFor(type) {
  if (type === "weapon") return ["weaponToHit", "weaponToDamage", "weaponBoth"];
  if (type === "armor") return ["armorLight", "armorAC"];
  return [];
}

/**
 * Apply (or clear) a masterwork tier on an item. RR p159 masterwork is fully
 * expressible in fields core already has (+1 hit = system.bonus, +1 damage = a
 * "1d6 + 1" string, +1 AC = aac.value, −1 stone = weight6), so this STAMPS those
 * fields rather than adding a roll-time overlay — the deliberate design (see the
 * note by config.MASTERWORK / constants.mjs). The pre-masterwork values are
 * remembered under the `masterwork` flag so switching tiers — or clearing back
 * to "none" — restores exactly.
 * @param {Item} item
 * @param {string|null} tier a config.MASTERWORK key, or "none"/null to clear.
 */
export async function setMasterwork(item, tier) {
  if (!item) return;
  const existing = item.getFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK);
  // The baseline is captured once, on first application, and reused thereafter —
  // so re-applying never compounds a die string or a bonus onto an already-
  // masterwork item.
  const base = existing?.base ?? {
    bonus: Number(item.system?.bonus ?? 0),
    damage: item.system?.damage ?? "",
    ac: Number(item.system?.aac?.value ?? 0),
    weight6: Number(item.system?.weight6 ?? 0),
  };
  const mw = tier && tier !== "none" ? MASTERWORK[tier] : null;
  if (!mw) {
    await item.update?.({
      "system.bonus": base.bonus,
      ...(item.type === "weapon" ? { "system.damage": base.damage } : {}),
      ...(item.type === "armor" ? { "system.aac.value": base.ac } : {}),
      "system.weight6": base.weight6,
    });
    await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK);
    return;
  }
  const update = { "system.bonus": base.bonus + (mw.toHit ?? 0) };
  if (item.type === "weapon") update["system.damage"] = addToDamage(base.damage, mw.toDamage ?? 0);
  if (item.type === "armor") update["system.aac.value"] = base.ac + (mw.ac ?? 0);
  update["system.weight6"] = Math.max(0, base.weight6 - (mw.weightMinusStone ?? 0) * 6);
  await item.update?.(update);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK, { tier, base });
}

/* -------------------------------------------------------------------------- */
/*  Scavenged equipment (RR p160): roll a condition onto any weapon/armour     */
/* -------------------------------------------------------------------------- */

const rollD20 = () => 1 + Math.floor(Math.random() * 20);

/**
 * Expand a scavenged roll: each 19-20 result spawns two more d20s (RR p160),
 * accumulated in roll order. Bounded so a cascade of rerolls cannot loop. The
 * roller is injectable so tests can drive it deterministically.
 * @returns {number[]} every d20 rolled, in order.
 */
export function rollScavengedD20s(tableKey, roll = rollD20) {
  const rolls = [];
  const queue = [roll()];
  let guard = 0;
  while (queue.length && guard++ < 32) {
    const r = queue.shift();
    rolls.push(r);
    if (needsReroll(tableKey, r)) queue.push(roll(), roll());
  }
  return rolls;
}

/** The pristine (pre-scavenge) fields captured for exact reversal. */
const scavengeBase = (item) => ({
  bonus: Number(item.system?.bonus ?? 0),
  damage: item.system?.damage ?? "",
  ac: Number(item.system?.aac?.value ?? 0),
  weight6: Number(item.system?.weight6 ?? 0),
});

/** Restore an item's fields from a stored scavenged base (no-op if none). */
async function restoreScavengeBase(item) {
  const sc = item.getFlag?.(MODULE_ID, "scavenged");
  if (!sc?.base) return;
  await item.update?.({
    "system.bonus": sc.base.bonus,
    ...(item.type === "weapon" ? { "system.damage": sc.base.damage } : {}),
    ...(item.type === "armor" ? { "system.aac.value": sc.base.ac } : {}),
    "system.weight6": sc.base.weight6,
  });
}

/** Clear a scavenged condition, restoring the item's pristine fields. */
export async function clearScavenged(item) {
  await restoreScavengeBase(item);
  await item.unsetFlag?.(MODULE_ID, "scavenged");
}

/**
 * Roll a scavenged condition (RR p160) onto any weapon or armour and stamp the
 * result on the item's own core fields (−damage → a "1d6-1" string, −attack →
 * bonus, −AC → aac.value, +stone → weight6) plus a `scavenged` flag carrying the
 * labels, break/sneak/initiative notes, and value multiplier for the Judge.
 * REVERSIBLE: the pristine fields are remembered under the flag, and a re-roll
 * restores them first so conditions never compound. The right table is chosen
 * from the item type + damage type. `roll` is injectable for tests.
 * @returns {Promise<{rolls:number[], tableKey:string, cond:object}|null>}
 */
export async function scavengeItem(item, { roll } = {}) {
  if (!item || (item.type !== "weapon" && item.type !== "armor")) return null;
  await restoreScavengeBase(item); // a re-roll always starts from pristine fields
  const base = scavengeBase(item);
  const profile = item.type === "weapon" ? classifyWeapon(item) : null;
  const tableKey = tableFor(item, profile);
  const rolls = rollScavengedD20s(tableKey, roll);
  const cond = accumulate(tableKey, rolls);
  const updates = toItemUpdates(item, cond); // reads the pristine fields restored above
  updates[`flags.${MODULE_ID}.scavenged`] = { ...updates[`flags.${MODULE_ID}.scavenged`], base };
  await item.update?.(updates);
  return { rolls, tableKey, cond };
}

/* -------------------------------------------------------------------------- */
/*  Shield variant (JJ pp407-408): make any shield a buckler/kite/etc.        */
/* -------------------------------------------------------------------------- */

/** Every shield-variant key (standard + the six JJ variants). */
export const SHIELD_VARIANT_KEYS = Object.keys(SHIELD_VARIANTS);

/**
 * Set (or clear) a shield's variant. The AC correction, encumbrance, strap
 * validity, and Specialization rules all read this flag live through the
 * shield-variant overlay, so a plain shield becomes a buckler/kite/etc. with no
 * field stamping — clearing back to "standard" removes the flag.
 */
export async function setShieldVariant(item, key) {
  if (!item) return;
  if (!key || key === "standard") await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT);
  else await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT, key);
}
