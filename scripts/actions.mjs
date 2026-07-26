/* global game, ui, CONFIG */
/**
 * Sheet-triggered equipment ACTIONS — the mutations the wear-bucket controls
 * invoke. Kept out of the render code (sheet.mjs) so each is unit-testable
 * against mock documents, and exposed on the module API for macros.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { SHIELD_VARIANTS } from "./config.mjs";
import { equipmentClass, classifyWeapon } from "./profiles.mjs";
import { consumeItem, roundsOf } from "./ammo.mjs";
import { tableFor, accumulate, needsReroll, SCAVENGED_TABLES } from "./overlays/scavenged.mjs";
import { recomputeItemFields, withFlatDelta } from "./properties.mjs";

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

/** Append a flat +N/−N to a damage die string, combining any existing one. */
export const addToDamage = withFlatDelta;

/** The masterwork tiers that apply to a given item type (drives the picker). */
export function masterworkTiersFor(type) {
  if (type === "weapon") return ["weaponToHit", "weaponToDamage", "weaponBoth"];
  if (type === "armor") return ["armorLight", "armorAC"];
  return [];
}

/**
 * Apply (or clear) a masterwork tier on an item. RR p159 masterwork is fully
 * expressible in fields core already has (+1 hit = system.bonus, +1 damage, +1 AC
 * = aac.value, −1 stone = weight6), so it STAMPS those fields rather than adding
 * a roll-time overlay — the deliberate design (see config.MASTERWORK).
 *
 * The fields are written by recomputeItemFields from the item's ONE pristine
 * baseline plus every active layer, so masterwork and a scavenged condition
 * coexist and either can be cleared without disturbing the other.
 * @param {Item} item
 * @param {string|null} tier a config.MASTERWORK key, or "none"/null to clear.
 */
export async function setMasterwork(item, tier) {
  if (!item) return;
  const key = tier && tier !== "none" ? tier : null;
  await recomputeItemFields(item, { masterwork: key });
  if (key) await item.setFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK, { tier: key });
  else await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK);
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

/** Clear a scavenged condition; the fields fall back to the remaining layers. */
export async function clearScavenged(item) {
  await recomputeItemFields(item, { scavenged: null });
  await item.unsetFlag?.(MODULE_ID, "scavenged");
}

/** Store a chosen (or rolled) condition and recompute the item's fields. */
export async function setScavenged(item, cond) {
  if (!item) return;
  if (!cond) return clearScavenged(item);
  await recomputeItemFields(item, { scavenged: cond });
  await item.setFlag?.(MODULE_ID, "scavenged", cond);
}

/** Set a scavenged condition from a single table row key (the inline picker). */
export async function setScavengedRow(item, tableKey, rowIndex) {
  const rows = SCAVENGED_TABLES[tableKey] ?? [];
  const row = rows[rowIndex];
  if (!row || row.reroll) return null;
  const cond = accumulate(tableKey, [row.max]); // any roll landing on this row
  await setScavenged(item, cond);
  return cond;
}

/**
 * Find the world RollTable holding a scavenged-condition table, if the GM has
 * imported one from their own book (acks-content's rules-table import). Matched
 * by a `ruledata` key flag first, then by name — so a hand-built table works too.
 * @returns {RollTable|null}
 */
export function scavengedRollTable(tableKey) {
  const wanted = `equipment.scavenged.${tableKey}`.toLowerCase();
  const tables = globalThis.game?.tables;
  if (!tables) return null;
  const byFlag = tables.find?.(
    (t) => String(t.getFlag?.("acks-location", "ruledata")?.key ?? t.getFlag?.("acks-content", "ruledata")?.key ?? "").toLowerCase() === wanted,
  );
  if (byFlag) return byFlag;
  const NAME = {
    piercingSlashing: /scaveng.*(pierc|slash|blade|weapon)/i,
    bludgeoning: /scaveng.*(bludgeon|blunt)/i,
    armourEquipment: /scaveng.*(armou?r|equipment)/i,
  }[tableKey];
  return (NAME && tables.find?.((t) => NAME.test(t.name ?? ""))) || null;
}

/**
 * Roll a scavenged condition (RR p160) onto any weapon or armour.
 *
 * THE ROLL PREFERS THE IMPORTED TABLE: when the GM has imported the condition
 * table from their own book as a world RollTable, it is DRAWN natively (its own
 * formula, its own chat card, GM-editable rows) and the drawn row is matched back
 * to the mechanical effects. Without it the built-in RAW table stands in, so the
 * control always works. Each 19-20 result spawns two more rolls either way.
 *
 * Fields are written by recomputeItemFields, so a re-roll never compounds and a
 * coexisting masterwork survives. `roll` is injectable for tests.
 * @returns {Promise<{rolls:number[], tableKey:string, cond:object, table:string|null}|null>}
 */
export async function scavengeItem(item, { roll } = {}) {
  if (!item || (item.type !== "weapon" && item.type !== "armor")) return null;
  const profile = item.type === "weapon" ? classifyWeapon(item) : null;
  const tableKey = tableFor(item, profile);

  let rolls = [];
  let table = null;
  const imported = roll ? null : scavengedRollTable(tableKey);
  if (imported?.draw) {
    // Draw from the GM's own table, honouring its formula and posting its card.
    table = imported.name;
    const queue = [null];
    let guard = 0;
    while (queue.length && guard++ < 32) {
      queue.shift();
      const drawn = await imported.draw({ displayChat: true });
      const n = Number(drawn?.roll?.total);
      const v = Number.isFinite(n) ? n : rollD20();
      rolls.push(v);
      if (needsReroll(tableKey, v)) queue.push(null, null);
    }
  } else {
    rolls = rollScavengedD20s(tableKey, roll);
  }

  const cond = accumulate(tableKey, rolls);
  await setScavenged(item, cond);
  return { rolls, tableKey, cond, table };
}

/* -------------------------------------------------------------------------- */
/*  Apparent value / disguise (GM tool): show mundane, keep the truth hidden    */
/* -------------------------------------------------------------------------- */

/**
 * Give an item an APPARENT identity: overwrite what the sheet shows (name, value,
 * damage/AC, description, icon) with mundane values, keeping the TRUE identity in
 * a flag so the GM can Reveal it later. The real WEIGHT is untouched, so the
 * player can still carry it for encumbrance. Reversible; capturing the truth once
 * means re-disguising never loses it.
 *
 * NOT a security boundary — the flag rides on the item, which Foundry replicates
 * to the owning player's client (the same caveat containers.mjs documents for
 * locked chests). It hides the truth from the SHEET, with no player-visible
 * indicator; for genuinely secret loot, keep the real item on a GM actor until
 * it is handed over. GM-only in the UI.
 * @param {Item} item
 * @param {{name?,cost?,damage?,ac?,description?,img?}} apparent
 */
export async function disguiseItem(item, apparent = {}) {
  if (!item) return;
  const existing = item.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
  const truth = existing?.true ?? {
    name: item.name,
    img: item.img,
    cost: Number(item.system?.cost ?? 0),
    damage: item.system?.damage ?? "",
    ac: Number(item.system?.aac?.value ?? 0),
    description: item.system?.description ?? "",
  };
  const update = { name: apparent.name ?? truth.name };
  if (apparent.img) update.img = apparent.img;
  if (apparent.cost != null && apparent.cost !== "") update["system.cost"] = Number(apparent.cost);
  if (item.type === "weapon" && apparent.damage != null && apparent.damage !== "") update["system.damage"] = apparent.damage;
  if (item.type === "armor" && apparent.ac != null && apparent.ac !== "") update["system.aac.value"] = Number(apparent.ac);
  if (apparent.description != null) update["system.description"] = apparent.description;
  await item.update?.(update);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE, { true: truth, apparent });
}

/** Drop the disguise, restoring the item's true identity. */
export async function revealItem(item) {
  const d = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
  if (!d?.true) return;
  const t = d.true;
  const update = { name: t.name, img: t.img, "system.cost": t.cost, "system.description": t.description };
  if (item.type === "weapon") update["system.damage"] = t.damage;
  if (item.type === "armor") update["system.aac.value"] = t.ac;
  await item.update?.(update);
  await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
}

/** Is this item wearing an apparent identity? (GM-facing.) */
export function isDisguised(item) {
  return !!item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
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
