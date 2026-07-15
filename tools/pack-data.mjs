/**
 * Compendium document builders for acks-equipment.
 *
 * Phase 1 ships the support macros. Proficiency ability-items (Phase 2) and
 * annotated sample equipment (Phase 5) extend the exported builders. Keep this
 * file free of Foundry runtime imports — it runs under plain Node at build time.
 */

const MODULE_ID = "acks-equipment";
const now = Date.now();
const STATS = { coreVersion: "14", createdTime: now, modifiedTime: now };

/* -------------------------------------------- */
/*  Macros                                       */
/* -------------------------------------------- */

const MACROS = [
  {
    _id: "acksEqInspect000",
    name: "Loadout Inspector",
    img: "icons/svg/upgrade.svg",
    command: `// Show the selected actor's RAW loadout: hands, fighting style, and any violations.
const api = game.modules.get("acks-equipment")?.api ?? globalThis.acksEquipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }
const lo = api.getLoadout(actor);
const rows = lo.weapons.map((w) =>
  \`<tr><td>\${w.item.name}</td><td>\${w.profile.size}</td><td>\${w.handsMin}\${w.wieldTwoHanded ? " (2H)" : ""}</td></tr>\`).join("");
const viol = lo.violations.length
  ? "<ul>" + lo.violations.map((v) => \`<li class="\${v.advisory ? "" : "notification error"}">\${v.type}: \${(v.items || []).map((i) => i.name).join(", ")}</li>\`).join("") + "</ul>"
  : "<p><em>Legal loadout.</em></p>";
const content = \`<div class="acks-equipment-loadout">
  <p><b>Hands</b> \${lo.handsUsed}/\${lo.handBudget} · <b>Style</b> \${lo.activeStyle}\${lo.styleProficient ? "" : " <em>(untrained)</em>"}</p>
  <table><thead><tr><th>Weapon</th><th>Size</th><th>Hands</th></tr></thead><tbody>\${rows || "<tr><td colspan=3><em>none equipped</em></td></tr>"}</tbody></table>
  <p><b>Armour</b> \${lo.armor?.name ?? "none"}\${lo.shield ? " · <b>Shield</b> " + lo.shield.name : ""}\${lo.hasHelmet ? " · helmet" : ""}</p>
  \${viol}</div>\`;
new foundry.applications.api.DialogV2({ window: { title: \`Loadout — \${actor.name}\` }, content, buttons: [{ action: "ok", label: "Close", default: true }] }).render(true);`,
  },
  {
    _id: "acksEqAnnotate00",
    name: "Annotate Weapons (RAW profiles)",
    img: "icons/svg/book.svg",
    command: `// Stamp acks-equipment size/hands/quality flags onto the selected actor's weapons
// (or, with no selection, every weapon in the world) from the built-in RAW lookup.
const api = game.modules.get("acks-equipment")?.api ?? globalThis.acksEquipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
const items = actor ? actor.items.filter((i) => i.type === "weapon") : game.items.filter((i) => i.type === "weapon");
let n = 0;
for (const it of items) { if (await api.annotateItem(it)) n++; }
ui.notifications.info(\`Annotated \${n} weapon(s)\${actor ? " on " + actor.name : " in the world"}.\`);`,
  },
];

export function buildMacros() {
  return MACROS.map((m) => ({
    _id: m._id,
    _key: `!macros!${m._id}`,
    name: m.name,
    type: "script",
    img: m.img,
    scope: "global",
    command: m.command,
    folder: null,
    flags: {},
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  }));
}

/** Phase 2 fills this (proficiency ability items). */
export function buildProficiencies() {
  return [];
}

/** Phase 5 fills this (annotated sample equipment + shield variants). */
export function buildSamples() {
  return [];
}

export { MODULE_ID, STATS };
