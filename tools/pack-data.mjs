/**
 * Compendium document content for acks-equipment (module-owned; the harness in
 * tools/build-packs.mjs is synced from acks-module-template and consumes the
 * `packs` map exported at the bottom of this file).
 *
 * Keep this file free of Foundry runtime imports — it runs under plain Node at
 * build time.
 *
 * _stats timestamps are FIXED, not Date.now(): a fixed stamp keeps every
 * rebuild byte-identical so `packs/_source` never churns (see
 * acks-module-template docs/TOOLCHAIN.md §2 and §8).
 */

const MODULE_ID = "acks-equipment";
const STAMP = 1784101908835; // fixed; matches the committed pack sources
const STATS = { coreVersion: "14", createdTime: STAMP, modifiedTime: STAMP };

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
    _id: "acksEqContainer0",
    name: "Containers",
    img: "icons/containers/bags/pack-leather-brown.webp",
    command: `// Popout container view: nested inventory with a RAW weight roll-up.
// Contents stay real items flagged containedIn, so core's encumbrance already
// counts them once (RR p. 161); the harness and bowquiver corrections are
// applied by the module's encumbrance wrapper.
const MOD = "acks-equipment";
const api = game.modules.get(MOD)?.api ?? globalThis.acksEquipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }

const report = api.containerReport(actor);
if (!report.length) {
  ui.notifications.warn("No containers on this character. Run the Annotate macro to flag backpacks, sacks, the adventurer's harness, and bowquivers from core's equipment pack.");
  return;
}
const st = (w6) => (w6 / 6).toFixed(2).replace(/\\.00$/, "");
const rows = report.map((c) => {
  const contents = c.contents.length
    ? c.contents.map((i) => \`<li>\${i.name} <span style="opacity:.7">(\${st(i.system.weight6 ?? 0)} st)</span></li>\`).join("")
    : "<li><em>empty</em></li>";
  const cap = c.capacityStone ? \`\${st(c.load6)} / \${c.capacityStone} st\` : \`\${st(c.load6)} st\`;
  return \`<fieldset style="margin-bottom:.5rem">
    <legend>\${c.item.name} — <strong style="color:\${c.over ? "var(--color-level-error,#b60205)" : "inherit"}">\${cap}</strong>\${c.over ? " (over capacity!)" : ""}</legend>
    <ul style="margin:.25rem 0 0 1rem">\${contents}</ul>
  </fieldset>\`;
}).join("");
const loose = actor.items.filter((i) => ["item", "weapon", "armor"].includes(i.type) && !i.getFlag(MOD, "containedIn") && !api.isContainer(i));
const delta6 = api.encumbranceDelta6(actor);
const note = delta6
  ? \`<p><em>RAW corrections applied: \${st(Math.abs(delta6))} st \${delta6 < 0 ? "ignored" : "added"} (adventurer's harness / bowquiver).</em></p>\`
  : "";
const content = \`<div class="acks-equipment-loadout">
  \${rows}
  <p><b>Carried loose:</b> \${loose.length} item(s) · <b>Total encumbrance:</b> \${actor.system.encumbrance?.value ?? "?"} / \${actor.system.encumbrance?.max ?? "?"} st</p>
  \${note}
  <p style="opacity:.7;font-size:.9em">Put an item in a container by setting its <code>flags.\${MOD}.containedIn</code> to the container's id; clear it to take the item out.</p>
</div>\`;
new foundry.applications.api.DialogV2({
  window: { title: \`Containers — \${actor.name}\` },
  content,
  buttons: [{ action: "ok", label: "Close", default: true }],
  position: { width: 460 },
}).render(true);`,
  },
  {
    _id: "acksEqItemLoss00",
    name: "Item Loss from Damage",
    img: "icons/svg/fire.svg",
    command: `// JJ p. 398 (optional): an area attack that drops a creature to -6 hp or lower
// destroys 1 stone of equipment, +1 per further 6 damage, in a fixed positional
// order, skipping materials the damage type cannot harm.
const MOD = "acks-equipment";
const api = game.modules.get(MOD)?.api ?? globalThis.acksEquipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
if (!game.settings.get(MOD, "overlayItemLoss")) { ui.notifications.warn("Enable the 'Item loss from damage' overlay in module settings first."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token."); return; }
const types = ["acidic","arcane","bludgeoning","piercing","poisonous","slashing","cold","electric","fire","luminous","necrotic","seismic"];
const form = await foundry.applications.api.DialogV2.prompt({
  window: { title: \`Item Loss — \${actor.name}\` },
  content: \`<div style="display:grid;gap:.5rem">
    <p>Applies only when the creature was reduced to <b>-6 hp or lower</b> by an area attack it did not save against.</p>
    <label>Hit points after the attack <input type="number" name="hp" value="\${actor.system.hp?.value ?? -6}"></label>
    <label>Damage type <select name="dt">\${types.map((t) => \`<option value="\${t}">\${t}</option>\`).join("")}</select></label>
    <label><input type="checkbox" name="rear"> Damaged from the flank or rear (reverses the order)</label>
  </div>\`,
  ok: { label: "Resolve", callback: (_e, btn) => new FormData(btn.form) },
  rejectClose: false,
});
if (!form) return;
const loadout = api.getLoadout(actor);
const plan = api.planItemLoss(actor, loadout, { hp: Number(form.get("hp")), damageType: form.get("dt"), fromRear: !!form.get("rear") });
if (!plan.stones) { ui.notifications.info("Not at -6 hp or lower: no equipment is at risk."); return; }
const list = plan.destroyed.length
  ? plan.destroyed.map((d) => \`<li><b>\${d.item.name}</b> <span style="opacity:.7">(\${d.material})</span></li>\`).join("")
  : "<li><em>nothing vulnerable to that damage type</em></li>";
ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: \`<div class="acks-equipment-loadout"><h3>Item Loss — \${actor.name}</h3>
    <p><b>\${plan.stones}</b> stone at risk (\${form.get("dt")}\${form.get("rear") ? ", from the rear" : ""}).</p>
    <ul>\${list}</ul>
    <p style="opacity:.75;font-size:.9em">\${plan.survivors} item(s) were immune to this damage type and skipped. Magic items get a saving throw (wielder's progression) before being destroyed; items of 2+ stone are damaged rather than destroyed, losing 1 AC per full stone.</p>
  </div>\`,
});`,
  },
  {
    _id: "acksEqDrawSheath",
    name: "Draw / Sheathe",
    img: "icons/svg/sword.svg",
    command: `// Draw/sheathe a weapon or ready/sling a shield, reporting the RAW action cost.
// RR pp. 293-294: sheathing one weapon and drawing another is an action in lieu
// of movement (dropping one instead is free); readying a shield likewise.
// Fighting Style Specialization (RR p. 108) makes both cost no action.
const MOD = "acks-equipment";
const api = game.modules.get(MOD)?.api ?? globalThis.acksEquipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }
const gear = actor.items.filter((i) => i.type === "weapon" || (i.type === "armor" && i.system.type === "shield"));
if (!gear.length) { ui.notifications.warn("No weapons or shields on this character."); return; }
const freeSwap = api.hasEffectFlag(actor, "freeSwap");
const opts = gear.map((i) => \`<option value="\${i.id}">\${i.system.equipped ? "Sheathe / sling" : "Draw / ready"} — \${i.name}</option>\`).join("");
const costText = freeSwap
  ? "<b>Fighting Style Specialization:</b> this costs <b>no action</b>."
  : "Costs an <b>action in lieu of movement</b>. (Dropping a weapon rather than sheathing it is free.)";
const form = await foundry.applications.api.DialogV2.prompt({
  window: { title: \`Draw / Sheathe — \${actor.name}\` },
  content: \`<p>\${costText}</p><label>Item <select name="id" style="width:100%">\${opts}</select></label>\`,
  ok: { label: "Do it", callback: (_e, btn) => new FormData(btn.form) },
  rejectClose: false,
});
if (!form) return;
const item = actor.items.get(form.get("id"));
await item.update({ "system.equipped": !item.system.equipped });
ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: \`<p><b>\${actor.name}</b> \${item.system.equipped ? "draws/readies" : "sheathes/slings"} <b>\${item.name}</b> — \${freeSwap ? "no action (Fighting Style Specialization)" : "an action in lieu of movement"}.</p>\`,
});`,
  },
  {
    _id: "acksEqConfig0000",
    name: "Configure Proficiencies",
    img: "icons/svg/statue.svg",
    command: `// Set the selected actor's fighting styles, weapon proficiency, and armour cap.
const MOD = "acks-equipment";
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }
const cur = {
  styles: actor.getFlag(MOD, "styles") ?? "single,missile",
  weaponProficiency: actor.getFlag(MOD, "weaponProficiency") ?? "all",
  armorMax: actor.getFlag(MOD, "armorMax") ?? "heavy",
};
const armours = ["unarmored", "veryLight", "light", "medium", "heavy"];
const content = \`<div style="display:grid;gap:.5rem">
  <label>Fighting styles (CSV of single, missile, dual, twoHanded, weaponShield)
    <input name="styles" value="\${cur.styles}"></label>
  <label>Weapon proficiency ("all" or CSV of categories/weapons)
    <input name="weaponProficiency" value="\${cur.weaponProficiency}"></label>
  <label>Maximum armour category
    <select name="armorMax">\${armours.map((a) => \`<option value="\${a}" \${a === cur.armorMax ? "selected" : ""}>\${a}</option>\`).join("")}</select></label>
</div>\`;
const form = await foundry.applications.api.DialogV2.prompt({
  window: { title: \`Proficiencies — \${actor.name}\` },
  content,
  ok: { label: "Save", callback: (_ev, btn) => new FormData(btn.form) },
  rejectClose: false,
});
if (!form) return;
await actor.update({
  [\`flags.\${MOD}.styles\`]: form.get("styles"),
  [\`flags.\${MOD}.weaponProficiency\`]: form.get("weaponProficiency"),
  [\`flags.\${MOD}.armorMax\`]: form.get("armorMax"),
});
ui.notifications.info(\`Saved proficiency profile for \${actor.name}.\`);`,
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

/* -------------------------------------------- */
/*  Proficiency ability items (RR pp. 105–121)  */
/* -------------------------------------------- */

// Each proficiency is an `ability` item carrying a transferred Active Effect
// whose changes are the module's data-driven markers (flags.acks-equipment.*),
// read by scripts/effects.mjs. Mode "override" is the v14 string-typed change
// mode (CONST.ACTIVE_EFFECT_CHANGE_TYPES key); numbers in that enum are only
// default priorities. See docs/MODEL.md §3.

const BOOK = "icons/svg/book.svg";
const UP = "icons/svg/upgrade.svg";

// prof spec: { n:name, t:general|class, m:{domain:value,...}, r:requirements, d:description }
const PROFS = [
  // Fighting Style Specialization — each grants its style bonus + the free
  // draw/sheathe/ready-shield swap (RR p. 108).
  { n: "Fighting Style Specialization (Missile Weapon)", t: "class", m: { styleProficient: "missile:spec", freeSwap: "1" }, r: "Missile weapon fighting style", d: "+1 to attack throws while wielding a missile weapon. Can draw/sheathe a weapon or ready/sling a shield without spending an action." },
  { n: "Fighting Style Specialization (Single Weapon)", t: "class", m: { styleProficient: "single:spec", freeSwap: "1" }, r: "Single weapon fighting style", d: "+1 to initiative while wielding a single tiny/small/medium melee weapon and nothing in the other hand. Free draw/sheathe/ready-shield." },
  { n: "Fighting Style Specialization (Dual Weapon)", t: "class", m: { styleProficient: "dual:spec", freeSwap: "1" }, r: "Dual weapon fighting style", d: "+1 to attack throws (for a total of +2 with the base dual-weapon bonus) while wielding a weapon in each hand. Free draw/sheathe/ready-shield." },
  { n: "Fighting Style Specialization (Two-Handed Weapon)", t: "class", m: { styleProficient: "twoHanded:spec", freeSwap: "1" }, r: "Two-handed weapon fighting style", d: "+1 to damage rolls while wielding a medium or large melee weapon in both hands. Free draw/sheathe/ready-shield." },
  { n: "Fighting Style Specialization (Weapon & Shield)", t: "class", m: { styleProficient: "weaponShield:spec", freeSwap: "1" }, r: "Weapon & shield fighting style", d: "+1 to Armor Class (for a total of +2 with the shield) while wielding a weapon and shield. Free draw/sheathe/ready-shield." },

  { n: "Weapon Finesse", t: "class", m: { finesse: "1" }, r: "Tiny, small, or medium melee weapons", d: "Use the Dexterity modifier instead of the Strength modifier on attack throws with tiny, small, or medium melee weapons." },

  // Weapon Focus — extra damage die on a natural 20 with the favoured category.
  { n: "Weapon Focus (Axes)", t: "class", m: { weaponFocus: "axes" }, d: "On an unmodified 20 with an axe, inflict an additional die of damage." },
  { n: "Weapon Focus (Maces, Flails & Hammers)", t: "class", m: { weaponFocus: "macesflailshammers" }, d: "On an unmodified 20 with a mace, flail, or hammer, inflict an additional die of damage." },
  { n: "Weapon Focus (Swords & Daggers)", t: "class", m: { weaponFocus: "swordsdaggers" }, d: "On an unmodified 20 with a sword or dagger, inflict an additional die of damage." },
  { n: "Weapon Focus (Bows & Crossbows)", t: "class", m: { weaponFocus: "bowscrossbows" }, d: "On an unmodified 20 with a bow or crossbow, inflict an additional die of damage." },
  { n: "Weapon Focus (Slings & Thrown)", t: "class", m: { weaponFocus: "slingsthrown" }, d: "On an unmodified 20 with a sling or thrown weapon, inflict an additional die of damage." },
  { n: "Weapon Focus (Spears & Polearms)", t: "class", m: { weaponFocus: "spearspolearms" }, d: "On an unmodified 20 with a spear or polearm, inflict an additional die of damage." },

  { n: "Precise Shooting", t: "class", m: { preciseShooting: "1" }, d: "Make missile attacks against engaged targets at −4 (unengaged targets through a melee at no penalty) and ignore up to 4 points of cover. Take multiple times to reduce the −4 by 2 each." },
  { n: "Skirmishing", t: "class", m: { skirmishing: "1" }, d: "Withdraw or retreat without declaring it before initiative. No AC penalty when charging or running while wearing ≤ medium armour and carrying ≤ 7 stone." },
  { n: "Armour Training", t: "class", m: { armorTraining: "1" }, d: "Proficiency in armour one weight category heavier than the class normally allows, without penalty. Does not restore armour-gated thief skills or class powers." },

  // Martial Training — adds a weapon category to the proficient set.
  { n: "Martial Training (Axes)", t: "class", m: { martialWeapons: "axe" }, d: "Adds all axes to the character's proficient weapons." },
  { n: "Martial Training (Bows & Crossbows)", t: "class", m: { martialWeapons: "bow,crossbow" }, d: "Adds all bows and crossbows to the character's proficient weapons." },
  { n: "Martial Training (Flails, Hammers & Maces)", t: "class", m: { martialWeapons: "flailHammerMace" }, d: "Adds all flails, hammers, and maces to the character's proficient weapons." },
  { n: "Martial Training (Swords & Daggers)", t: "class", m: { martialWeapons: "swordDagger" }, d: "Adds all swords and daggers to the character's proficient weapons." },
  { n: "Martial Training (Spears & Polearms)", t: "class", m: { martialWeapons: "spearPolearm" }, d: "Adds all spears and polearms to the character's proficient weapons." },
  { n: "Martial Training (Bolas, Nets, Slings, Saps, Staffs & Staff-Slings)", t: "class", m: { martialWeapons: "other" }, d: "Adds bolas, nets, slings, saps, staffs, and staff-slings to the character's proficient weapons." },
  { n: "Martial Training (Choose Four Weapons)", t: "class", m: {}, d: "Adds any four weapons to the character's proficient weapons. <em>Set the four weapon names on the actor's <code>flags.acks-equipment.weaponProficiency</code> list.</em>" },

  // Combat Trickery — reduces a maneuver's penalty by 2 and the target's save by 2.
  { n: "Combat Trickery (Disarm)", t: "class", m: { maneuverTrickery: "disarm" }, d: "The disarm maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Force Back)", t: "class", m: { maneuverTrickery: "forceBack" }, d: "The force back maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Incapacitate)", t: "class", m: { maneuverTrickery: "incapacitate" }, d: "The incapacitate maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Knock Down)", t: "class", m: { maneuverTrickery: "knockDown" }, d: "The knock down maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Overrun)", t: "class", m: { maneuverTrickery: "overrun" }, d: "The overrun maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Sunder)", t: "class", m: { maneuverTrickery: "sunder" }, d: "The sunder maneuver's penalty is reduced by 2 and the target saves at −2." },
  { n: "Combat Trickery (Wrestling)", t: "class", m: { maneuverTrickery: "wrestling" }, d: "The wrestling maneuver's penalty is reduced by 2 and the target saves at −2." },

  { n: "Combat Reflexes", t: "class", m: { styleInit: "1" }, d: "+1 bonus to surprise rolls and initiative rolls (not when casting spells). <em>Initiative is automated; surprise is applied by the Judge.</em>" },
  { n: "Combat Ferocity", t: "class", m: { maxCleaves: "1" }, d: "The character's maximum number of cleaves is increased by 1." },
  { n: "Running", t: "class", m: { running: "1" }, d: "Base speed +30' when wearing ≤ medium armour and carrying ≤ 7 stone. <em>Speed is applied by movement modules (e.g. acks-formation); this module only publishes the marker.</em>" },
  { n: "Swashbuckling", t: "class", m: { swashbuckling: "1" }, d: "+1 AC (→+2 at level 7, +3 at level 13) while wearing ≤ light armour and carrying ≤ 5 stone." },
  { n: "Blind Fighting", t: "class", m: { blindFighting: "1" }, d: "Only −2 (instead of −4) on attack throws when blinded or against invisible enemies; no surprise penalty from being blinded; no speed reduction." },
  { n: "Mounted Combat", t: "class", m: { mountedCombat: "1" }, d: "Ride a saddled animal in combat without penalty and gain +1 to attack throws while mounted. With Riding, ride without saddle/bit/bridle in combat." },
  { n: "Riding", t: "general", m: { riding: "1" }, d: "Ride without saddle, bit, or bridle in non-combat conditions; ride a saddled animal in combat without penalty; force-march without fatigue." },
  { n: "Berserkergang", t: "class", m: { berserkergang: "1" }, d: "Enter a rage on a combat action: +2 melee/thrown attack, immune to cowering/faltering/frightened, never checks morale, but −2 AC and cannot make defensive movement." },
  { n: "Ambushing", t: "class", m: { ambushing: "1" }, d: "Ambush any vulnerable opponent (melee or short-range missile): +4 attack and an extra die of damage." },
  { n: "Sniping", t: "class", m: { sniping: "1" }, d: "Ambush or backstab with missile weapons at up to long range (others are limited to short range)." },
  { n: "Goblin-Slaying", t: "class", m: { slayer: "goblin:1" }, d: "+1 (→+2 at level 7, +3 at level 13) on attack throws against kobolds, goblins, orcs, gnolls, hobgoblins, bugbears, ogres, trolls, and giants." },
  { n: "Vermin-Slaying", t: "class", m: { slayer: "vermin:1" }, d: "+1 to hit and +1 to saving throws against oozes and vermin; identify their abilities and vulnerabilities on 11+." },
  { n: "Unarmed Fighting", t: "class", m: { unarmedFighting: "1" }, d: "Deal lethal damage when brawling, and damage foes in metal armour without hurting yourself." },
];

function effectDoc(itemId, effId, name, markers) {
  const changes = Object.entries(markers).map(([domain, value]) => ({
    key: `flags.${MODULE_ID}.${domain}`,
    mode: "override",
    value: String(value),
    priority: 50,
  }));
  return {
    _id: effId,
    // Embedded docs are compiled as their own LevelDB entries, so they need a
    // _key: !<parentCollection>.<embeddedCollection>!<parentId>.<embeddedId>.
    _key: `!items.effects!${itemId}.${effId}`,
    name,
    img: UP,
    type: "base",
    changes,
    disabled: false,
    transfer: true,
    duration: {},
    description: "",
    origin: null,
    tint: "#ffffff",
    statuses: [],
    flags: {},
  };
}

function proficiencyDoc(p, i) {
  const id = `acksEqProf${String(i + 1).padStart(6, "0")}`; // 16 chars
  const effId = `acksEqPfEf${String(i + 1).padStart(6, "0")}`; // 16 chars
  const hasMarkers = Object.keys(p.m).length > 0;
  return {
    _id: id,
    _key: `!items!${id}`,
    name: p.n,
    type: "ability",
    img: BOOK,
    system: {
      proficiencytype: p.t,
      favorite: false,
      pattern: "white",
      requirements: p.r ?? "",
      roll: "",
      rollType: "above",
      rollTarget: 0,
      blindroll: false,
      description: `<p>${p.d}</p>`,
      save: "",
      _schemaVersion: 3,
    },
    effects: hasMarkers ? [effectDoc(id, effId, p.n, p.m)] : [],
    flags: { [MODULE_ID]: { example: true } },
    ownership: { default: 0 },
    sort: (i + 1) * 100,
    _stats: { ...STATS },
  };
}

export function buildProficiencies() {
  return PROFS.map(proficiencyDoc);
}

/* -------------------------------------------- */
/*  Class training chunks (JJ p. 290-291)       */
/* -------------------------------------------- */

// The JJ Fighting Value selections, broken into the individual chunks the book
// actually lists — NOT per-class bundles. A class grants some combination of
// these; drag on the ones its Fighting Value bought. Each carries the effect
// markers the enforcement engine reads (docs/RULES.md §5/§6).

const TRAINING = [
  // Fighting styles (JJ p. 291). Single + Missile are mandatory for every class.
  { n: "Fighting Style: Single Weapon", m: { styleProficient: "single" }, d: "Fighting while wielding a single tiny, small, or medium melee weapon. <em>Mandatory for every class.</em>" },
  { n: "Fighting Style: Missile Weapon", m: { styleProficient: "missile" }, d: "Fighting while wielding a missile weapon in one, both, or each hand (depending on the weapon). <em>Mandatory for every class.</em>" },
  { n: "Fighting Style: Dual Weapon", m: { styleProficient: "dual" }, d: "Fighting while wielding a tiny, small, or medium melee weapon in each hand. Grants the RAW +1 to melee attack throws for the second weapon." },
  { n: "Fighting Style: Two-Handed Weapon", m: { styleProficient: "twoHanded" }, d: "Fighting while wielding a medium or large melee weapon in both hands." },
  { n: "Fighting Style: Weapon & Shield", m: { styleProficient: "weaponShield" }, d: "Fighting while wielding a small, tiny, or medium weapon or missile weapon in one hand and a shield in the other. <strong>Classes which lack this style gain no benefit from shields.</strong>" },

  // Armour proficiency ladder (JJ p. 290). Each includes everything lighter.
  { n: "Armour Proficiency: None", m: { armourProficiency: "unarmored" }, d: "No armour proficiency. Such a class also cannot select the Weapon &amp; Shield fighting style." },
  { n: "Armour Proficiency: Very Light", m: { armourProficiency: "veryLight" }, d: "Proficiency with very light armour (hide, fur, padded)." },
  { n: "Armour Proficiency: Light", m: { armourProficiency: "light" }, d: "Proficiency with light and very light armour (leather and below)." },
  { n: "Armour Proficiency: Medium", m: { armourProficiency: "medium" }, d: "Proficiency with medium, light, and very light armour (chain and below)." },
  { n: "Armour Proficiency: Heavy", m: { armourProficiency: "heavy" }, d: "Proficiency with heavy, medium, light, and very light armour (all armour)." },

  // Unrestricted (JJ p. 290).
  { n: "Weapon Selection: Unrestricted", m: { weaponProf: "all" }, d: "The class has proficiency in <strong>all</strong> weapons. (Fighting Value 2+.)" },

  // Narrow: any 2 of these 7 (JJ p. 290).
  { n: "Narrow Weapons: Any Axes", m: { weaponProf: "axe" }, d: "Narrow selection (i): any axes." },
  { n: "Narrow Weapons: Any Bows & Crossbows", m: { weaponProf: "bow,crossbow" }, d: "Narrow selection (ii): any bows and crossbows." },
  { n: "Narrow Weapons: Any Flails, Hammers & Maces", m: { weaponProf: "flailHammerMace" }, d: "Narrow selection (iii): any flails, hammers, and maces." },
  { n: "Narrow Weapons: Any Swords & Daggers", m: { weaponProf: "swordDagger" }, d: "Narrow selection (iv): any swords and daggers." },
  { n: "Narrow Weapons: Any Spears & Pole Arms", m: { weaponProf: "spearPolearm" }, d: "Narrow selection (v): any spears and pole arms." },
  { n: "Narrow Weapons: Bolas, Cestus, Nets, Saps, Slings, Staff-Slings & Whips", m: { weaponProf: "other" }, d: "Narrow selection (vi): any bolas, cestus, nets, saps, slings, staff-slings, and whips." },
  { n: "Narrow Weapons: Any Combination of 3 Weapons", m: {}, d: "Narrow selection (vii): any combination of 3 weapons. <em>List the three on the effect's <code>weaponProf</code> change (comma-separated weapon names). Composite/long bow require short bow; spear/pole arm require javelin.</em>" },

  // Broad: any 2 of these 6 (JJ p. 290). Note (i) and (ii) are SIZE-based.
  { n: "Broad Weapons: Any Tiny, Small or Medium Melee", m: { weaponProf: "melee:tiny,melee:small,melee:medium" }, d: "Broad choice (i): any tiny, small, or medium melee weapons." },
  { n: "Broad Weapons: Any Medium or Large Melee", m: { weaponProf: "melee:medium,melee:large" }, d: "Broad choice (ii): any medium or large melee weapons." },
  { n: "Broad Weapons: Any Axes, Flails, Hammers & Maces", m: { weaponProf: "axe,flailHammerMace" }, d: "Broad choice (iii): any axes, flails, hammers, and maces." },
  { n: "Broad Weapons: Any Swords, Daggers, Spears & Polearms", m: { weaponProf: "swordDagger,spearPolearm" }, d: "Broad choice (iv): any swords, daggers, spears, and polearms." },
  { n: "Broad Weapons: All Missile Weapons", m: { weaponProf: "missile:all" }, d: "Broad choice (v): all missile weapons." },
  { n: "Broad Weapons: Any Combination of 5 Weapons", m: {}, d: "Broad choice (vi): any combination of 5 weapons. <em>List the five on the effect's <code>weaponProf</code> change. Composite/long bow require short bow; spear/pole arm require javelin.</em>" },
];

// Restricted: any 4 of these 10 specific weapons (JJ p. 290).
const RESTRICTED_WEAPONS = ["Bola", "Cestus", "Club", "Dagger", "Dart", "Net", "Sap", "Sling", "Staff", "Whip"];
for (const w of RESTRICTED_WEAPONS) {
  TRAINING.push({
    n: `Restricted Weapon: ${w}`,
    m: { weaponProf: w.toLowerCase() },
    d: `Restricted selection: proficiency with the ${w.toLowerCase()}. A restricted class picks <strong>any 4</strong> of bola, cestus, club, dagger, dart, net, sap, sling, staff, whip.`,
  });
}

function trainingDoc(t, i) {
  const id = `acksEqTrain${String(i + 1).padStart(5, "0")}`; // 16 chars
  const effId = `acksEqTrEf${String(i + 1).padStart(6, "0")}`;
  const hasMarkers = Object.keys(t.m).length > 0;
  return {
    _id: id,
    _key: `!items!${id}`,
    name: t.n,
    type: "ability",
    img: "icons/svg/sword.svg",
    system: {
      proficiencytype: "class", favorite: false, pattern: "white", requirements: "",
      roll: "", rollType: "above", rollTarget: 0, blindroll: false,
      description: `<p>${t.d}</p><p><em>Class training chunk — Judges Journal pp. 290–291. Grant the chunks the character's class actually bought with its Fighting Value.</em></p>`,
      save: "", _schemaVersion: 3,
    },
    effects: hasMarkers ? [effectDoc(id, effId, t.n, t.m)] : [],
    flags: { [MODULE_ID]: { example: true, training: true } },
    ownership: { default: 0 },
    sort: (i + 1) * 100,
    _stats: { ...STATS },
  };
}

export function buildTraining() {
  return TRAINING.map(trainingDoc);
}

/* -------------------------------------------- */
/*  Sample equipment (JJ pp. 407-408; RR p. 159)*/
/* -------------------------------------------- */

// These AUGMENT core's acks-all-equipment rather than duplicate it: everything
// here is content the core system does not ship. Ordinary RAW weapons/armour
// stay in core and are upgraded in place by the "Annotate Weapons" macro.

const SHIELD_VARIANTS = [
  { k: "buckler", n: "Buckler", w: 1, d: "A round shield up to 2' across. <strong>Only</strong> characters with Fighting Style Specialization (Weapon &amp; Shield) gain its +1 AC; others gain no benefit. Does not protect a vulnerable character. Encumbrance 1 item." },
  { k: "auxiliary", n: "Auxiliary Shield", w: 6, d: "A hexagonal or oval shield ~2'×3.5' for light infantry and cavalry. In hand: +1 AC (dismounted, except when surprised, retreating, or attacked from behind; mounted, to self or mount, alternating each move). Strapped on the back: +1 AC against attacks from behind (Specialization does not increase this). 1 stone." },
  { k: "crescent", n: "Crescent Shield", w: 6, d: "An oval shield with crescent cut-outs. In hand: +1 AC except when vulnerable. Strapped on the front: +1 AC except when vulnerable (2 stone, no Specialization bonus). Strapped on the back: +1 AC against attacks from behind (no Specialization bonus). 1 stone." },
  { k: "heater", n: "Heater Shield", w: 6, d: "A heart-shaped shield 2' across and 3' tall. In hand: +1 AC (dismounted, except when vulnerable; mounted, to self or mount, alternating each move). Strapped on the back: +1 AC against attacks from behind (no Specialization bonus). 1 stone." },
  { k: "kite", n: "Kite Shield", w: 12, d: "A leaf- or almond-shaped cavalry shield. Dismounted: +1 AC but 2 stone of encumbrance. Mounted: +1 AC to <em>both</em> rider and mount, 1 stone each. Cannot be strapped on the back. Does not protect a vulnerable character or mount." },
  { k: "phalanx", n: "Phalanx Shield", w: 6, d: "A large curved dipylon, figure-eight, rectangular, or round shield. Dismounted only: +1 AC, 1 stone. Counts as a shield for the <strong>Defend</strong> action. Cannot be strapped on the back. Does not protect a vulnerable character." },
];

const SAMPLE_ITEMS = [
  ...SHIELD_VARIANTS.map((s) => ({
    name: s.n,
    type: "armor",
    img: "icons/equipment/shield/heater-steel-worn.webp",
    system: { cost: 10, weight6: s.w, aac: { value: 1 }, type: "shield", description: `<p>${s.d}</p><p><em>Judges Journal optional shield rules (pp. 407–408). Enable the shield-variant overlay to apply the type-specific rules; otherwise it behaves as a standard +1 AC shield.</em></p>` },
    flags: { shieldVariant: s.k, strap: "hand" },
  })),
  {
    name: "Masterwork Sword (+1 attack)",
    type: "weapon",
    img: "icons/weapons/swords/sword-guard-steel.webp",
    system: { cost: 90, weight6: 1, damage: "1d6", bonus: 1, melee: true, missile: false, description: "<p>A masterwork sword: +1 to attack throws (+80gp over the base 10gp). It does not let you hit monsters only harmed by magic.</p><p><em>Revised Rulebook p. 159. Masterwork and magic bonuses do not stack — enchanting a weapon makes it masterwork automatically.</em></p>" },
    flags: { size: "medium", damageType: "slashing", masterwork: { toHit: 1 } },
  },
  {
    name: "Masterwork Plate Armour (+1 AC)",
    type: "armor",
    img: "icons/equipment/chest/breastplate-layered-steel.webp",
    system: { cost: 710, weight6: 36, aac: { value: 7 }, type: "heavy", description: "<p>Masterwork plate: AC 7 at the normal 6 stone weight (+650gp over the base 60gp).</p><p><em>Revised Rulebook p. 159. The cheaper +80gp masterwork instead sheds one stone of weight at normal AC.</em></p>" },
    flags: { masterwork: { ac: 1 } },
  },
  {
    name: "Tooth-Breaker (named war hammer)",
    type: "weapon",
    img: "icons/weapons/hammers/hammer-war-spiked.webp",
    system: { cost: 0, weight6: 1, damage: "1d6", bonus: 1, melee: true, missile: false, description: "<p>A rune-carved war hammer. Its finder named it <em>Tooth-Breaker</em>, unlocking one bonus category; each level of experience earned while wielding it unlocks another point, until its full power is reached. Speaking its true name would grant all its powers at once.</p><p><em>Judges Journal naming rules (p. 399). Enable the named-item overlay to track unlocking by level.</em></p>" },
    flags: { size: "small", damageType: "bludgeoning", named: { trueName: "Fist of Iron", unlocked: 1, max: 3 } },
  },
];

function sampleDoc(s, i) {
  const id = `acksEqSamp${String(i + 1).padStart(6, "0")}`; // 16 chars
  return {
    _id: id,
    _key: `!items!${id}`,
    name: s.name,
    type: s.type,
    img: s.img,
    system: { _schemaVersion: 3, ...s.system },
    effects: [],
    flags: { [MODULE_ID]: { example: true, ...s.flags } },
    ownership: { default: 0 },
    sort: (i + 1) * 100,
    _stats: { ...STATS },
  };
}

export function buildSamples() {
  return SAMPLE_ITEMS.map(sampleDoc);
}

/* -------------------------------------------- */
/*  Sample actors (demonstrate the automation)  */
/* -------------------------------------------- */

// Pre-wired characters so the module can be seen working immediately: each
// carries the proficiency profile flags, the proficiency items (with their
// effect markers) and an equipped loadout that exercises one rule.

const scores = (str, dex, con = 10, int = 10, wis = 10, cha = 10) => ({
  str: { value: str }, dex: { value: dex }, con: { value: con },
  int: { value: int }, wis: { value: wis }, cha: { value: cha },
});

const gearWeapon = (name, damage, over = {}) => ({
  name,
  type: "weapon", img: "icons/weapons/swords/sword-guard-steel.webp",
  system: { damage, melee: true, missile: false, equipped: true, weight6: 1, cost: 10, bonus: 0, ...over },
});
const gearArmour = (name, type, aac, w) => ({
  name,
  type: "armor", img: "icons/equipment/chest/breastplate-layered-steel.webp",
  system: { type, aac: { value: aac }, equipped: true, weight6: w, cost: 10 },
});

const SAMPLE_ACTORS = [
  {
    name: "Sample: Sword & Board Fighter",
    img: "icons/environment/people/commoner.webp",
    bio: "Demonstrates the <strong>Weapon &amp; Shield</strong> fighting style: the shield gives +1 AC and Fighting Style Specialization another +1, for AC 2 above the armour — applied automatically through the loadout effect. Try equipping a second one-handed weapon: the hand budget (2) is exceeded and the module warns and auto-resolves.",
    flags: { styles: "single,missile,weaponShield,twoHanded", weaponProficiency: "all", armorMax: "heavy" },
    level: 3, scores: scores(13, 11, 12),
    profs: ["Fighting Style Specialization (Weapon & Shield)"],
    gear: [gearWeapon("Sword", "1d6"), gearArmour("Shield", "shield", 1, 6), gearArmour("Chain Mail Armor", "medium", 4, 24)],
  },
  {
    name: "Sample: Two-Handed Barbarian",
    img: "icons/environment/people/commoner.webp",
    bio: "Demonstrates the <strong>Two-Handed</strong> fighting style: a two-handed sword uses both hands, and Fighting Style Specialization adds +1 damage. Swap in a plain Sword (medium) and the module wields it two-handed for 1d8 instead of 1d6.",
    flags: { styles: "single,missile,twoHanded", weaponProficiency: "all", armorMax: "medium" },
    level: 3, scores: scores(16, 10, 14),
    profs: ["Fighting Style Specialization (Two-Handed Weapon)", "Combat Ferocity"],
    gear: [gearWeapon("Two-Handed Sword", "1d10"), gearArmour("Leather Armor", "light", 2, 12)],
  },
  {
    name: "Sample: Dual-Wield Thief",
    img: "icons/environment/people/commoner.webp",
    bio: "Demonstrates the <strong>Dual Weapon</strong> style (+1 to melee attack throws for the second weapon, +1 more from Specialization) and <strong>Weapon Finesse</strong> (DEX replaces STR on the attack throw). In leather and without a shield, the armour-gated thief skills (Backstabbing, Hiding, Pickpocketing, Sneaking) remain available — equip a shield and the module flags them as blocked.",
    flags: { styles: "single,missile,dual", weaponProficiency: "swordDagger", armorMax: "light" },
    level: 3, scores: scores(9, 16, 11),
    profs: ["Fighting Style Specialization (Dual Weapon)", "Weapon Finesse"],
    gear: [gearWeapon("Short Sword", "1d6"), gearWeapon("Dagger", "1d4"), gearArmour("Leather Armor", "light", 2, 12)],
  },
  {
    name: "Sample: Mage (Restricted Weapons)",
    img: "icons/environment/people/commoner.webp",
    bio: "Demonstrates <strong>non-proficiency</strong>. The mage is proficient only with club, dagger, dart, and staff, and wears no armour. The Staff attacks normally; the Sword is equipped but untrained, so attacking with it takes the RAW −1 penalty (shown in the chat card's total) and gains no fighting-style benefit. The armour cap is <em>unarmored</em>, so wearing the leather is flagged as beyond proficiency.",
    flags: { styles: "single,missile", weaponProficiency: "club,dagger,dart,staff", armorMax: "unarmored" },
    level: 3, scores: scores(8, 12, 10, 16),
    profs: [],
    gear: [gearWeapon("Staff", "1d4"), gearWeapon("Sword", "1d6")],
  },
];

/** Embedded copy of a proficiency item, keyed under its owning actor. */
function embeddedProficiency(actorId, profName, seq) {
  const p = PROFS.find((x) => x.n === profName);
  if (!p) throw new Error(`sample actor references unknown proficiency: ${profName}`);
  const id = `acksEqAP${String(seq).padStart(8, "0")}`;
  const effId = `acksEqAE${String(seq).padStart(8, "0")}`;
  const hasMarkers = Object.keys(p.m).length > 0;
  const effect = hasMarkers ? effectDoc(id, effId, p.n, p.m) : null;
  if (effect) effect._key = `!actors.items.effects!${actorId}.${id}.${effId}`;
  return {
    _id: id,
    _key: `!actors.items!${actorId}.${id}`,
    name: p.n,
    type: "ability",
    img: BOOK,
    system: {
      proficiencytype: p.t, favorite: false, pattern: "white", requirements: p.r ?? "",
      roll: "", rollType: "above", rollTarget: 0, blindroll: false,
      description: `<p>${p.d}</p>`, save: "", _schemaVersion: 3,
    },
    effects: effect ? [effect] : [],
    flags: { [MODULE_ID]: { example: true } },
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

/** Embedded copy of a gear item, keyed under its owning actor. */
function embeddedGear(actorId, g, name, seq) {
  const id = `acksEqAG${String(seq).padStart(8, "0")}`;
  return {
    _id: id,
    _key: `!actors.items!${actorId}.${id}`,
    name,
    type: g.type,
    img: g.img,
    system: { _schemaVersion: 3, ...g.system },
    effects: [],
    flags: { [MODULE_ID]: { example: true } },
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

function actorDoc(a, i) {
  const id = `acksEqActor${String(i + 1).padStart(5, "0")}`; // 16 chars
  let seq = i * 100;
  const items = [
    ...a.profs.map((p) => embeddedProficiency(id, p, ++seq)),
    ...a.gear.map((g) => embeddedGear(id, g, g.name, ++seq)),
  ];
  return {
    _id: id,
    _key: `!actors!${id}`,
    name: a.name,
    type: "character",
    img: a.img,
    system: {
      _schemaVersion: 3,
      scores: a.scores,
      details: { level: a.level, class: "Sample", biography: `<p>${a.bio}</p>` },
      hp: { value: 12, max: 12, hd: "1d8" },
      config: { movementAuto: true },
    },
    items,
    effects: [],
    prototypeToken: { name: a.name, actorLink: false },
    flags: { [MODULE_ID]: { example: true, ...a.flags } },
    ownership: { default: 0 },
    sort: (i + 1) * 100,
    _stats: { ...STATS },
  };
}

export function buildActors() {
  return SAMPLE_ACTORS.map(actorDoc);
}

export { MODULE_ID, STATS };

/**
 * Pack contract for the synced tools/build-packs.mjs harness (see
 * acks-module-template): pack name -> document builder. Empty packs are
 * skipped by the harness and stay undeclared in module.json.
 */
export const packs = {
  "equipment-training": buildTraining,
  "equipment-proficiencies": buildProficiencies,
  "equipment-samples": buildSamples,
  "equipment-actors": buildActors,
  macros: buildMacros,
};
