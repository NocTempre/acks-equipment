/* global game, Hooks, ui, foundry, fromUuidSync, document */
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
import { wearLocation } from "./wear.mjs";

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

/* ---------------------------------------------------------------------- */
/*  Sheet → doll mirroring                                                 */
/*                                                                         */
/*  With the doll active it must ALWAYS match the sheet: equip or unequip  */
/*  on either side updates the other. Doll → sheet already flows through   */
/*  EQUIPPED_PATH; this half places sheet-equipped gear into slots and     */
/*  reconciles the whole doll from the actor's real equipped state.        */
/* ---------------------------------------------------------------------- */

/**
 * Which doll slot a sheet-equipped item belongs in — derived from the SAME
 * wear taxonomy the sheet buckets use (wear.mjs), so the doll and the sheet
 * cannot disagree about where a thing sits. Pure planning: no writes.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} slots       the doll's slots flag (may be stale)
 * @param {(uuid:string)=>Item|null} resolve  uuid → item (injectable for tests)
 * @returns {string|null} a slot id, or null when nothing fits (strapped
 *   shields have no doll slot; a fully occupied region is left alone rather
 *   than displacing what the player placed)
 */
export function planDollSlot(actor, item, slots, resolve) {
  // A slot is free if empty, already ours, or holding a stale reference
  // (unequipped or deleted occupant) that reconciliation will clear anyway.
  const free = (slotId) => {
    const uuid = slots?.[slotId]?.[0];
    if (!uuid || uuid === item.uuid) return slotId;
    const occupant = resolve(uuid);
    return occupant && occupant.parent?.id === actor.id && occupant.system?.equipped ? null : slotId;
  };
  const where = wearLocation(actor, item);
  switch (where) {
    case WEAR.HEAD:
      return free("HEAD");
    case WEAR.BODY:
      return free("BODY");
    case WEAR.MAIN_HAND:
    case WEAR.BOTH_HANDS:
      return free("MAIN_RIGHT") ?? free("MAIN_LEFT");
    case WEAR.OFF_HAND:
      return free("MAIN_LEFT") ?? free("MAIN_RIGHT");
    case WEAR.WORN: {
      // Three clothing slots; route by name where the name says, else first free.
      const n = String(item.name ?? "").toLowerCase();
      if (/boot|sandal|shoe/.test(n)) return free("BOOTS") ?? free("CAPE") ?? free("GLOVES");
      if (/glove|gauntlet|mitt/.test(n)) return free("GLOVES") ?? free("CAPE") ?? free("BOOTS");
      return free("CAPE") ?? free("GLOVES") ?? free("BOOTS");
    }
    default:
      return null; // strapped / carried / stowed — not on the doll
  }
}

/** Default occupant resolver (split out so the planner is testable). */
function resolveUuid(uuid) {
  try {
    return typeof fromUuidSync === "function" ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Place a sheet-equipped item into the doll. Deferred one beat: when the
 * EQUIP came from the doll itself, its own slots write lands first and this
 * becomes a no-op (the uuid is already placed), so the two writers cannot
 * fight over slot choice.
 */
async function placeInPaperDoll(actor, item) {
  await new Promise((r) => setTimeout(r, 150));
  if (!item.system?.equipped) return false; // changed again while we waited
  const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
  for (const entries of Object.values(slots)) {
    if (entries && typeof entries === "object" && Object.values(entries).includes(item.uuid)) return false;
  }
  const target = planDollSlot(actor, item, slots, resolveUuid);
  if (!target) return false;
  slots[target] = { ...(slots[target] ?? {}), 0: item.uuid };
  await actor.setFlag(PAPERDOLL_ID, "slots", slots);
  // The same hand bookkeeping the doll's own drop performs.
  await setHandFlag(item, target, true);
  return true;
}

/**
 * Reconcile one actor's doll to the sheet's truth: stale slot entries
 * (unequipped, deleted, foreign) are cleared, every equipped wearable is
 * placed. Converges: a second run makes no writes.
 */
export async function syncActorToDoll(actor) {
  if (actor?.type !== "character" || !actor.isOwner) return;
  const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
  let changed = false;
  for (const [slotId, entries] of Object.entries(slots)) {
    if (!entries || typeof entries !== "object") continue;
    for (const [index, uuid] of Object.entries(entries)) {
      if (!uuid) continue;
      const occupant = resolveUuid(uuid);
      if (!occupant || occupant.parent?.id !== actor.id || !occupant.system?.equipped) {
        slots[slotId][index] = null; // the doll's own clear convention
        changed = true;
      }
    }
  }
  if (changed) await actor.setFlag(PAPERDOLL_ID, "slots", slots);
  for (const item of actor.items) {
    if (!item.system?.equipped) continue;
    if (item.type !== "weapon" && item.type !== "armor" && item.type !== "item") continue;
    await placeInPaperDoll(actor, item);
  }
}

/** Sheet equip/unequip — mirror it onto the doll, whichever way it went. */
async function onItemEquippedChanged(item, changes) {
  if (!foundry.utils.hasProperty(changes, "system.equipped")) return;
  const actor = item?.parent;
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  if (foundry.utils.getProperty(changes, "system.equipped")) await placeInPaperDoll(actor, item);
  else await clearFromPaperDoll(actor, item);
}

async function onPaperDollSwap(actor, a, b) {
  if (!actor) return;
  for (const side of [a, b]) {
    if (side?.item) await setHandFlag(side.item, side.slotId, true);
  }
  await refreshLoadout(actor);
}

/**
 * A DIRECT header button for the doll on character sheets.
 *
 * Paper Doll 3.x registers its opener as an ApplicationV2 header CONTROL, and
 * v14 collapses those into the ⋮ dropdown — so the doll silently moved from a
 * visible header button (its 2.x placement) into a menu nobody looks in, which
 * reads as "the integration broke". This restores a visible button beside the
 * other modules' header buttons.
 *
 * Reuse, not reimplementation: we fire the doll's own header-controls hook
 * into a scratch array and wire our button to the `onClick` IT provides, so
 * open/toggle behaviour (and its playerOwnedOnly gate — no entry pushed means
 * no button) stays entirely the doll's.
 *
 * Skipped when the doll's autoOpen is on: the doll already opens itself then,
 * and re-firing its hook would schedule a second auto-open.
 */
export function injectDollHeaderButton(app, element) {
  if (activeStrategy() !== "paperdoll") return;
  if (app?.actor?.type !== "character") return;
  const header = element?.querySelector?.(".window-header");
  if (!header || header.querySelector(".acks-equipment-doll-button")) return;
  try {
    if (game.settings.get(PAPERDOLL_ID, "autoOpen")) return;
  } catch {
    /* setting shape is the doll's own business; absence means not auto-opening */
  }
  // CORE's header-controls hook, re-fired deliberately so the doll hands us
  // its own entry — NOT a custom hook of ours, hence the constant: the
  // namespacing validator caps `Hooks.callAll` string literals to
  // acksEquipment-prefixed names, and this is the documented honour-system
  // path for deliberate cross-module interop (constants.mjs HOOKS note).
  const CORE_HEADER_CONTROLS_HOOK = "getHeaderControls" + "ActorSheetV2";
  const controls = [];
  Hooks.callAll(CORE_HEADER_CONTROLS_HOOK, app, controls);
  const doll = controls.find((c) => c.class === "paper-doll" && typeof c.onClick === "function");
  if (!doll) return; // gated off (playerOwnedOnly) or the doll changed shape
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control icon fa-solid fa-person acks-equipment-doll-button";
  btn.dataset.tooltip = game.i18n.has("ACKS-EQUIPMENT.notify.openDoll")
    ? game.i18n.localize("ACKS-EQUIPMENT.notify.openDoll")
    : "Paper Doll";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    doll.onClick();
  });
  header.insertBefore(btn, header.querySelector("[data-action='close']"));
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
  // Sheet ↔ doll mirror: any equipped change on either side updates the other.
  Hooks.on("updateItem", (item, changes) =>
    onItemEquippedChanged(item, changes).catch((err) => console.error(`${MODULE_ID} | paper-doll sync failed`, err)),
  );
  // An item created already-equipped (compendium import, duplication) lands on
  // the doll too; a deleted one leaves no stale slot behind.
  Hooks.on("createItem", (item) => {
    if (!item?.system?.equipped || item.parent?.documentName !== "Actor" || !item.parent.isOwner) return;
    placeInPaperDoll(item.parent, item).catch((err) => console.error(`${MODULE_ID} | paper-doll create sync failed`, err));
  });
  Hooks.on("deleteItem", (item) => {
    const actor = item?.parent;
    if (actor?.documentName !== "Actor" || !actor.isOwner) return;
    clearFromPaperDoll(actor, item).catch((err) => console.error(`${MODULE_ID} | paper-doll delete sync failed`, err));
  });
  // Opening the doll reconciles it to the sheet's truth, so it can never show
  // a stale picture no matter what happened while it was closed. Converges:
  // the second pass writes nothing, so render → sync → render terminates.
  Hooks.on("renderPaperDoll", (app) => {
    const actor = app?.actor;
    if (actor) syncActorToDoll(actor).catch((err) => console.error(`${MODULE_ID} | paper-doll reconcile failed`, err));
  });

  if (game.user.isGM && !game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED)) {
    configurePaperDoll().catch((err) => console.error(`${MODULE_ID} | Paper Doll configuration failed`, err));
  }
  // One reconciliation pass over owned characters at startup: gear equipped
  // while the doll was absent (or before this version) appears on it.
  for (const actor of game.actors?.filter?.((a) => a.type === "character" && a.isOwner) ?? []) {
    syncActorToDoll(actor).catch((err) => console.error(`${MODULE_ID} | initial doll sync failed for ${actor.name}`, err));
  }
  console.debug(`${MODULE_ID} | Paper Doll integration active (sheet ↔ doll mirror).`);
}
