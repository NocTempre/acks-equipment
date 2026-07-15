/* global Hooks, game, ui, foundry */
/**
 * ACKS II — Equipment & Fighting Styles: bootstrap.
 *
 * init  — settings, public API, template preload.
 * setup — libWrapper roll wrap (Phase 3).
 * ready — system guard, socketlib, paper-doll wiring (Phase 4), initial
 *         loadout sync, equip-enforcement hooks.
 */
import { MODULE_ID, SETTINGS } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { buildApi } from "./api.mjs";
import { onPreUpdateItem, onUpdateItem, refreshLoadout, primaryResponder } from "./enforce.mjs";
import { registerRollWrap } from "./roll-wrap.mjs";
import { registerPaperDoll } from "./paperdoll.mjs";

/** True on exactly one client: the active GM responsible for automation. */
function isPrimaryGM() {
  return game.users.activeGM?.isSelf ?? false;
}

Hooks.once("init", () => {
  registerSettings();
  buildApi();

  try {
    foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/loadout-summary.hbs`]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

Hooks.once("setup", () => {
  if (!game.settings.get(MODULE_ID, SETTINGS.ROLL_AUTOMATION)) return;
  try {
    registerRollWrap();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register roll wrapper`, err);
  }
});

Hooks.once("ready", async () => {
  if (game.system?.id !== "acks") {
    console.warn(`${MODULE_ID} | Active system is not "acks"; equipment automation is inert.`);
    return;
  }

  try {
    registerPaperDoll();
  } catch (err) {
    console.error(`${MODULE_ID} | paper-doll wiring failed`, err);
  }

  // Rebuild loadout effects for owned characters on load (repairs after config
  // changes, migrations, or a session where enforcement was off).
  const owned = game.actors.filter((a) => a.type === "character" && a.isOwner);
  for (const actor of owned) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | initial loadout sync failed for ${actor.name}`, err));
  }
});

/* -------------------------------------------- */
/*  Equip-limit enforcement                      */
/* -------------------------------------------- */

Hooks.on("preUpdateItem", (item, changes) => {
  try {
    return onPreUpdateItem(item, changes);
  } catch (err) {
    console.error(`${MODULE_ID} | preUpdateItem enforcement failed`, err);
    return true;
  }
});

Hooks.on("updateItem", (item, changes) => {
  onUpdateItem(item, changes).catch((err) => console.error(`${MODULE_ID} | updateItem enforcement failed`, err));
});

/* An item created already-equipped (drag-drop) or deleted while equipped also
 * changes the loadout. */
Hooks.on("createItem", (item) => {
  const actor = item?.parent;
  if (actor?.documentName === "Actor" && primaryResponder(actor) && ["weapon", "armor"].includes(item.type) && item.system?.equipped) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | createItem loadout sync failed`, err));
  }
});

Hooks.on("deleteItem", (item) => {
  const actor = item?.parent;
  if (actor?.documentName === "Actor" && primaryResponder(actor) && ["weapon", "armor"].includes(item.type)) {
    refreshLoadout(actor).catch((err) => console.error(`${MODULE_ID} | deleteItem loadout sync failed`, err));
  }
});

export { isPrimaryGM };
