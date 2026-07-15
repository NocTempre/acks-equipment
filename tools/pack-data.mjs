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

/** Phase 5 fills this (annotated sample equipment + shield variants). */
export function buildSamples() {
  return [];
}

export { MODULE_ID, STATS };
