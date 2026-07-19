/* global game, Hooks, ui, foundry */
/**
 * Paper Doll integration (theripper93's `fvtt-paper-doll-ui`), with a
 * max-per-type fallback when it is absent.
 *
 * Paper Doll is premium/signed, so this integrates purely through its public
 * surface — never a fork:
 *   - world setting `fvtt-paper-doll-ui.globalConfig` (merged over its CONSTS)
 *     carries our ACKS slot layout and `EQUIPPED_PATH`;
 *   - hooks `paper-doll-equip` / `paper-doll-swap` tell us what moved.
 *
 * `EQUIPPED_PATH` matters most: Paper Doll only writes the system's equipped
 * flag when that path is set, and its own `getEquippedPath()` returns "" for
 * anything but dnd5e. Setting it to "equipped" makes drag-and-drop write
 * `system.equipped` on ACKS weapons/armour — which flows straight into this
 * module's existing preUpdateItem/updateItem enforcement. So the doll becomes an
 * input device for the same RAW rules, not a parallel system.
 *
 * The slot layout is pushed ONCE (guarded by our `paperdollConfigured` setting)
 * so a GM's later customisation is never clobbered.
 */
import { MODULE_ID, SETTINGS, PAPERDOLL_ID, PAPERDOLL_HOOKS, ITEM_FLAGS } from "./constants.mjs";
import { WEAR } from "./config.mjs";
import { refreshLoadout } from "./enforce.mjs";

/** Which hand a Paper Doll slot represents (drives dual-wield vs two-handed). */
const HAND_BY_SLOT = Object.freeze({ MAIN_RIGHT: "main", MAIN_LEFT: "off" });

/**
 * Paper Doll slot → canonical wear location (config.mjs WEAR). The doll's slot
 * ids are fixed by ITS template, so this is the seam where the two vocabularies
 * meet — the sheet buckets and the doll must describe the same place, and this
 * mapping is what keeps them from drifting apart silently.
 */
export const SLOT_WEAR = Object.freeze({
  HEAD: WEAR.HEAD,
  BODY: WEAR.BODY,
  CAPE: WEAR.WORN,
  GLOVES: WEAR.WORN,
  BOOTS: WEAR.WORN,
  MAIN_RIGHT: WEAR.MAIN_HAND,
  MAIN_LEFT: WEAR.OFF_HAND,
});

/** Filters expressed as Paper Doll expects: a JS function body over `item`. */
const F_ARMOUR_SUIT = "return item.type === 'armor' && item.system?.type !== 'shield' && !/helm/i.test(item.name ?? '');";
const F_HELMET = "return item.type === 'armor' && /helm/i.test(item.name ?? '');";
const F_HAND = "return item.type === 'weapon' || (item.type === 'armor' && item.system?.type === 'shield');";

/**
 * ACKS slot layout. Region keys are fixed by Paper Doll's template
 * (LEFT / RIGHT / BOTTOM_*_WRIST / BOTTOM_*_MAIN) — only slots within them are
 * extensible, so we map ACKS concepts onto those regions rather than inventing
 * new ones.
 */
export const ACKS_PAPERDOLL_CONFIG = {
  EQUIPPED_PATH: "equipped",
  SLOTS: {
    LEFT: {
      HEAD: [{ img: "icons/equipment/head/helm-barbute-engraved-steel.webp", filter: F_HELMET }],
      CAPE: [{ img: "icons/equipment/back/cape-layered-red.webp", simpleFilter: ["item"] }],
      BODY: [{ img: "icons/equipment/chest/breastplate-layered-steel.webp", filter: F_ARMOUR_SUIT }],
      GLOVES: [{ img: "icons/equipment/hand/glove-frayed-cloth-grey.webp", simpleFilter: ["item"] }],
      BOOTS: [{ img: "icons/equipment/feet/boots-armored-layered-steel.webp", simpleFilter: ["item"] }],
    },
    BOTTOM_RIGHT_MAIN: {
      MAIN_RIGHT: [{ img: "icons/weapons/swords/sword-guard-steel.webp", filter: F_HAND }],
    },
    BOTTOM_LEFT_MAIN: {
      MAIN_LEFT: [{ img: "icons/equipment/shield/heater-steel-worn.webp", filter: F_HAND }],
    },
  },
};

/** Which equip source is authoritative: "paperdoll" or "fallback". */
export function activeStrategy() {
  const pref = game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_STRATEGY);
  const present = !!game.modules.get(PAPERDOLL_ID)?.active;
  if (pref === "fallback") return "fallback";
  return present ? "paperdoll" : "fallback"; // "auto" and "paperdoll" both need it installed
}

/** Push the ACKS slot layout + EQUIPPED_PATH once, without clobbering edits. */
async function configurePaperDoll() {
  const current = game.settings.get(PAPERDOLL_ID, "globalConfig") ?? {};
  const merged = foundry.utils.mergeObject(foundry.utils.deepClone(current), ACKS_PAPERDOLL_CONFIG, { inplace: false });
  await game.settings.set(PAPERDOLL_ID, "globalConfig", merged);
  await game.settings.set(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED, true);
  console.debug(`${MODULE_ID} | pushed ACKS slot layout + EQUIPPED_PATH to Paper Doll.`);
  ui.notifications?.info(
    game.i18n.has("ACKS-EQUIPMENT.notify.paperdollConfigured")
      ? game.i18n.localize("ACKS-EQUIPMENT.notify.paperdollConfigured")
      : "Paper Doll configured for ACKS equipment slots.",
  );
}

/** Record which hand a slot represents so dual-wield/off-hand can be resolved. */
async function setHandFlag(item, slotId, equipped) {
  const hand = HAND_BY_SLOT[slotId];
  if (!hand || !item?.isOwner) return;
  await item.setFlag(MODULE_ID, ITEM_FLAGS.WORN_HAND, equipped ? hand : null);
}

async function onPaperDollEquip(actor, item, equipped, slotData) {
  if (!actor || !item) return;
  await setHandFlag(item, slotData?.slotId, equipped);
  await refreshLoadout(actor); // self-guards to the primary responder
}

/**
 * Core sheet → doll. Unequipping on the character sheet must empty the slot on
 * the doll; without this the doll keeps showing the item as worn.
 *
 * Paper Doll's own clear path (`_onContextMenu`) empties a slot by assigning
 * **null** to `slots[slotId][slotIndex]` and re-saving the whole flag — it does
 * not delete the key — so we mirror that exactly. Assigning null over an already
 * null slot is a no-op, so the doll's own equip/unequip cannot loop back here.
 * @returns {Promise<boolean>} whether anything was cleared
 */
export async function clearFromPaperDoll(actor, item) {
  const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
  let changed = false;
  for (const [slotId, entries] of Object.entries(slots)) {
    if (!entries || typeof entries !== "object") continue;
    for (const [index, uuid] of Object.entries(entries)) {
      if (uuid && uuid === item.uuid) {
        slots[slotId][index] = null;
        changed = true;
      }
    }
  }
  if (changed) await actor.setFlag(PAPERDOLL_ID, "slots", slots);
  return changed;
}

/** Any unequip — sheet toggle, auto-resolve, or macro — empties the doll slot. */
async function onItemUnequipped(item, changes) {
  if (!foundry.utils.hasProperty(changes, "system.equipped")) return;
  if (foundry.utils.getProperty(changes, "system.equipped")) return; // equips are handled by the doll itself
  const actor = item?.parent;
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  await clearFromPaperDoll(actor, item);
}

async function onPaperDollSwap(actor, a, b) {
  if (!actor) return;
  for (const side of [a, b]) {
    if (side?.item) await setHandFlag(side.item, side.slotId, true);
  }
  await refreshLoadout(actor);
}

export function registerPaperDoll() {
  const strategy = activeStrategy();
  if (strategy !== "paperdoll") {
    console.debug(`${MODULE_ID} | Paper Doll not in use; max-per-type enforcement on the core inventory applies.`);
    return;
  }

  Hooks.on(PAPERDOLL_HOOKS.EQUIP, (actor, item, equipped, slotData) =>
    onPaperDollEquip(actor, item, equipped, slotData).catch((err) => console.error(`${MODULE_ID} | paper-doll-equip failed`, err)),
  );
  Hooks.on(PAPERDOLL_HOOKS.SWAP, (actor, a, b) =>
    onPaperDollSwap(actor, a, b).catch((err) => console.error(`${MODULE_ID} | paper-doll-swap failed`, err)),
  );
  // Core sheet → doll: keep the doll in step when gear is unequipped elsewhere.
  Hooks.on("updateItem", (item, changes) =>
    onItemUnequipped(item, changes).catch((err) => console.error(`${MODULE_ID} | paper-doll unequip sync failed`, err)),
  );

  if (game.user.isGM && !game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED)) {
    configurePaperDoll().catch((err) => console.error(`${MODULE_ID} | Paper Doll configuration failed`, err));
  }
  console.debug(`${MODULE_ID} | Paper Doll integration active.`);
}
