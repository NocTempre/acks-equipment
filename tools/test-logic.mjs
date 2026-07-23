/**
 * Pure-logic regression tests for the loadout model and effect builder.
 * Mocks the minimal Foundry globals and imports the real scripts, so bugs that
 * a running Foundry would surface (deprecated globals, case mismatches, wrong
 * hand costs, mis-detected violations) fail the release instead.
 *
 * Run: npm test
 */
import assert from "node:assert";

// Overlay toggles are read through game.settings; tests flip this to prove the
// overlay is inert when disabled and correct when enabled.
const SETTINGS_STATE = { overlayShieldVariants: false, overlayManeuvers: true };
globalThis.game = {
  settings: {
    get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : SETTINGS_STATE[k]),
  },
  i18n: { has: () => false, localize: (x) => x, format: (k) => k },
  modules: { get: () => ({ active: false }) },
  users: { activeGM: null },
};
// ApplicationV2 stubs. Modules that destructure `foundry.applications.api` at
// module scope die at IMPORT time if these are missing — the same class of
// failure as the v0.12.1 "module dead at init" bug — so the harness provides
// just enough shape for the files to load and be constructed.
class StubApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { return this; }
  close() { return this; }
  _onRender() {}
  _onFirstRender() {}
  _onClose() {}
}
globalThis.foundry = {
  utils: {
    deepClone: (x) => JSON.parse(JSON.stringify(x)),
    randomID: () => "rand0000",
    hasProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) !== undefined,
    getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o),
    mergeObject: (a, b) => ({ ...a, ...b }),
  },
  applications: {
    api: {
      ApplicationV2: StubApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: class { static async prompt() { return null; } },
    },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};
// v14: an AE change carries a string `type` (a key of ACTIVE_EFFECT_CHANGE_TYPES;
// the enum numbers are default priorities). Numeric `mode` is a deprecated shim —
// make the getter THROW so any access fails the test.
globalThis.CONST = {
  ACTIVE_EFFECT_CHANGE_TYPES: { custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50 },
};
Object.defineProperty(globalThis.CONST, "ACTIVE_EFFECT_MODES", {
  get() { throw new Error("accessed deprecated CONST.ACTIVE_EFFECT_MODES"); },
});

const S = new URL("../scripts/", import.meta.url);
const { classifyWeapon, handCost } = await import(new URL("profiles.mjs", S));
const { getLoadout, VIOLATION } = await import(new URL("loadout.mjs", S));
const { buildLoadoutChanges } = await import(new URL("effects.mjs", S));
const { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, swashbucklingAC } = await import(new URL("proficiency.mjs", S));
const { buildProficiencies, buildSamples, buildActors } = await import(new URL("../tools/pack-data.mjs", import.meta.url));
const { computeAttackMods } = await import(new URL("roll-wrap.mjs", S));

const weapon = (name, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "weapon",
  system: { equipped: over.equipped ?? true, damage: over.damage ?? "1d6", melee: over.melee, missile: over.missile, tags: over.tags ?? [] },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const armor = (name, type, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "armor",
  system: { equipped: over.equipped ?? true, type, aac: { value: over.ac ?? 0 } },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const actor = (items, over = {}) => ({
  id: "a1",
  type: "character",
  items,
  system: over.system ?? {},
  effects: over.effects ?? [],
  appliedEffects: over.effects ?? [],
  isOwner: true,
  getFlag: (_m, k) => (over.flags ?? {})[k],
});
const marker = (domain, value) => ({ id: "fx" + domain, name: domain, disabled: false, changes: [{ key: `flags.acks-equipment.${domain}`, value: String(value) }], flags: { "acks-equipment": {} } });

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

// classify + hand cost
const sword = classifyWeapon(weapon("Sword", { melee: true }));
check("sword medium melee", sword.size === "medium" && sword.melee);
check("sword 1H=1 / 2H=2", handCost(sword, { twoHanded: false }) === 1 && handCost(sword, { twoHanded: true }) === 2);
check("sword 2H damage 1d8", sword.damage2h === "1d8");
check("longbow 2 hands", handCost(classifyWeapon(weapon("Long Bow", { missile: true, melee: false }))) === 2);
check("sling handy 1 hand", handCost(classifyWeapon(weapon("Sling", { missile: true, melee: false }))) === 1);
check("dagger tiny thrown", (() => { const d = classifyWeapon(weapon("Dagger", { melee: true })); return d.size === "tiny" && d.thrown; })());
check("two-handed sword large 2 hands", handCost(classifyWeapon(weapon("Two-Handed Sword", { melee: true }))) === 2);
check("override size/hands flag wins", handCost(classifyWeapon(weapon("Stick", { flags: { size: "large", hands: 2 } }))) === 2);

// loadout scenarios
let lo = getLoadout(actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" })]));
check("sword+shield 2 hands, weaponShield, legal", lo.handsUsed === 2 && lo.activeStyle === "weaponShield" && lo.legal);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "a" }), weapon("Short Sword", { melee: true, id: "b" }), armor("Shield", "shield", { id: "s" })]));
check("3 one-handers → hand overflow, illegal", lo.violations.some((v) => v.type === VIOLATION.HAND_OVERFLOW) && !lo.legal);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "a" }), weapon("Dagger", { melee: true, id: "b" })]));
check("two weapons → dual", lo.activeStyle === "dual" && lo.handsUsed === 2 && lo.legal);
lo = getLoadout(actor([weapon("Two-Handed Sword", { melee: true, id: "t" })]));
check("great sword → twoHanded, 2 hands", lo.activeStyle === "twoHanded" && lo.handsUsed === 2);
lo = getLoadout(actor([weapon("Sword", { melee: true, id: "s" })]));
check("lone medium sword wielded 2H", lo.weapons[0].wieldTwoHanded && lo.handsUsed === 2);
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Chain", "medium", { id: "c" })]));
check("two suits → multipleArmor, keeps last", lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.armor?.id === "c");
lo = getLoadout(actor([armor("Plate", "heavy", { id: "p" }), armor("Heavy Helmet", "medium", { id: "h" })]));
check("helmet excluded from suit count", !lo.violations.some((v) => v.type === VIOLATION.MULTIPLE_ARMOR) && lo.hasHelmet);

// loadout Active Effect (v14 string mode; no deprecated CONST; case-insensitive spec)
const specEffect = { id: "fx1", name: "FSS (W&S)", disabled: false, changes: [{ key: "flags.acks-equipment.styleProficient", value: "weaponShield:spec" }], flags: { "acks-equipment": {} } };
const specActor = actor([weapon("Sword", { melee: true, id: "sw" }), armor("Shield", "shield", { ac: 1, id: "sh" })], { effects: [specEffect], flags: { styles: "weaponShield" } });
const specLo = getLoadout(specActor);
check("spec actor → weaponShield active", specLo.activeStyle === "weaponShield" && specLo.styleProficient);
const changes = buildLoadoutChanges(specActor, specLo);
const ac = changes.find((c) => c.key === "system.aac.mod");
check("W&S spec → +1 aac.mod with string type 'add'", ac && Number(ac.value) === 1 && ac.type === "add");

// --- Phase 2: proficiency resolution -----------------------------------------
const swordP = classifyWeapon(weapon("Sword", { melee: true }));
const axeP = classifyWeapon(weapon("Battle Axe", { melee: true }));
check("default weapon proficiency = all", isWeaponProficient(actor([]), swordP));
const restricted = actor([], { flags: { weaponProficiency: "swordDagger" } });
check("restricted: sword proficient, axe not", isWeaponProficient(restricted, swordP) && !isWeaponProficient(restricted, axeP));
const martial = actor([], { flags: { weaponProficiency: "swordDagger" }, effects: [marker("martialWeapons", "axe")] });
check("Martial Training adds axe category", isWeaponProficient(martial, axeP));

check("default armorMax = heavy", armorMax(actor([])) === "heavy");
const lightOnly = actor([], { flags: { armorMax: "light" } });
check("armorMax light: leather ok, plate not", isArmorProficient(lightOnly, armor("Leather", "light")) && !isArmorProficient(lightOnly, armor("Plate", "heavy")));
const trained = actor([], { flags: { armorMax: "light" }, effects: [marker("armorTraining", "1")] });
check("Armour Training light→medium", armorMax(trained) === "medium" && isArmorProficient(trained, armor("Chain", "medium")));

check("thief gate: heavy armour blocks", thiefSkillsGated({ armor: armor("Plate", "heavy") }));
check("thief gate: leather + no shield ok", !thiefSkillsGated({ armor: armor("Leather", "light"), shield: null }));
check("thief gate: leather + shield blocks", thiefSkillsGated({ armor: armor("Leather", "light"), shield: armor("Shield", "shield") }));

const swash = actor([], { flags: {}, system: { details: { level: 1 }, encumbrance: { value: 3 } }, effects: [marker("swashbuckling", "1")] });
check("Swashbuckling L1 unarmoured → +1 AC", swashbucklingAC(swash, { armor: null }) === 1);
const swash7 = actor([], { system: { details: { level: 7 }, encumbrance: { value: 3 } }, effects: [marker("swashbuckling", "1")] });
check("Swashbuckling L7 → +2 AC", swashbucklingAC(swash7, { armor: null }) === 2);
check("Swashbuckling in heavy armour → 0", swashbucklingAC(swash, { armor: armor("Plate", "heavy") }) === 0);
check("Swashbuckling without proficiency → 0", swashbucklingAC(actor([]), { armor: null }) === 0);

// non-proficient weapon surfaces an advisory (never blocks)
const npLoadout = getLoadout(actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger" } }));
check("non-proficient weapon → advisory, still legal", npLoadout.violations.some((v) => v.type === VIOLATION.WEAPON_NOT_PROFICIENT && v.advisory) && npLoadout.legal);

// --- Phase 2: proficiencies compendium ---------------------------------------
const profs = buildProficiencies();
const ID = /^[A-Za-z0-9]{16}$/;
check("compendium builds 42 proficiencies", profs.length === 42);
check("all proficiency ids 16-char alphanumeric + matching _key", profs.every((d) => ID.test(d._id) && d._key === `!items!${d._id}`));
const ids = new Set(profs.map((d) => d._id));
check("proficiency ids unique", ids.size === profs.length);
const changeKeys = profs.flatMap((d) => (d.effects[0]?.changes ?? []).map((c) => c.key));
check("effect change keys are flags.acks-equipment.* with override type", changeKeys.length > 0 && changeKeys.every((k) => k.startsWith("flags.acks-equipment.")) && profs.every((d) => (d.effects[0]?.changes ?? []).every((c) => c.type === "override")));
const wsSpec = profs.find((d) => d.name.includes("Weapon & Shield"));
check("W&S spec item carries styleProficient=weaponShield:spec + freeSwap", wsSpec.effects[0].changes.some((c) => c.key.endsWith("styleProficient") && c.value === "weaponShield:spec") && wsSpec.effects[0].changes.some((c) => c.key.endsWith("freeSwap")));

// --- Phase 3: per-attack roll modifiers --------------------------------------
// Actors here need items.get(id); extend the mock minimally.
const rollActor = (items, over = {}) => {
  const a = actor(items, over);
  a.items = Object.assign(items.slice(), { get: (id) => items.find((i) => i.id === id) });
  a.system = over.system ?? { scores: { str: { mod: 1 }, dex: { mod: 3 } } };
  return a;
};
const swordItem = weapon("Sword", { melee: true, id: "sw" });
const attData = (item) => ({ item: { _id: item.id, name: item.name, system: { bonus: 0, damage: "1d6" } }, roll: {} });

// Proficient + trained style, one-handed with a shield → no per-attack mods.
let a = rollActor([swordItem, armor("Shield", "shield", { id: "sh" })], { flags: { styles: "weaponShield" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("proficient, trained, no finesse → no per-attack mods", computeAttackMods(a, attData(swordItem), { type: "melee" }) === null);

// --- RAW non-proficient use (RR p. 106 sidebar): the full package ------------
// 4th-level character (bba +2), STR +2, non-proficient weapon: attacks as a
// 0th-level fighter (bba −1 → delta −3) with no attribute bonus (−2) = −5.
const sysL4 = { details: { level: 4 }, thac0: { bba: 2 }, scores: { str: { mod: 2 }, dex: { mod: 1 } } };
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: sysL4 });
let m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("non-prof weapon, L4 bba+2 STR+2 → attacks as 0th-level fighter (−5)", m && m.bonusDelta === -5);

// Weapon and style BOTH untrained: one package, never two.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single" }, system: sysL4 });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("weapon+style both untrained → one package, not two", m.bonusDelta === -5);

// Attribute PENALTIES are not bonuses and still apply.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: -1 }, dex: { mod: 0 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("attribute penalty kept: only bba replaced (−1)", m.bonusDelta === -1);

// 0th-level characters still fight as 0th level, at an additional −1.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { details: { level: 0 }, thac0: { bba: -1 }, scores: { str: { mod: 0 }, dex: { mod: 0 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("0th-level non-proficient → additional −1 only", m.bonusDelta === -1);

// Missile attacks strip the DEX bonus instead of STR.
const bowItem = weapon("Long Bow", { missile: true, melee: false, id: "lb" });
a = rollActor([bowItem], { flags: { weaponProficiency: "axe", styles: "single,missile" }, system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 3 }, dex: { mod: 2 } } } });
m = computeAttackMods(a, attData(bowItem), { type: "missile" });
check("missile: DEX bonus stripped (−1 bba, −2 dex = −3)", m.bonusDelta === -3);

// Unusable ARMOUR degrades attacks made even with a PROFICIENT weapon —
// the trigger is the equipped state, not the weapon in hand.
const sysL1 = { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 1 }, dex: { mod: 1 } } };
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, system: sysL1 });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("unusable armour degrades proficient-weapon attacks (−2)", m && m.bonusDelta === -2);

// Weapon Finesse is inert while non-proficiently equipped: no attribute
// grants any bonus, so there is nothing to swap in.
a = rollActor([swordItem, armor("Plate", "heavy", { id: "pl" })], { flags: { armorMax: "light", styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { details: { level: 1 }, thac0: { bba: 0 }, scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("Weapon Finesse inert while non-proficiently equipped", m.bonusDelta === -2);

// Loadout: the state + full-package advisory violation, and the AC half —
// "no bonus on ... armor class from attributes" (bonuses only; penalties stay).
const npUse = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } });
const npUseLo = getLoadout(npUse);
check("nonProficientUse state + advisory violation, still legal", npUseLo.nonProficientUse === true && npUseLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE && v.advisory) && npUseLo.legal);
const npAcSum = buildLoadoutChanges(npUse, npUseLo).filter((c) => c.key === "system.aac.mod").reduce((s, c) => s + Number(c.value), 0);
check("no attribute bonus to AC while non-proficient (DEX +2 cancelled)", npAcSum === -2);
const npDexPen = actor([weapon("Battle Axe", { melee: true, id: "ax" })], { flags: { weaponProficiency: "swordDagger", styles: "single,twoHanded" }, system: { scores: { dex: { mod: -2 } }, details: { level: 3 } } });
check("DEX penalty to AC is kept (penalties are not bonuses)", buildLoadoutChanges(npDexPen, getLoadout(npDexPen)).filter((c) => c.key === "system.aac.mod").reduce((s, c) => s + Number(c.value), 0) === 0);
const profLo = getLoadout(actor([weapon("Sword", { melee: true, id: "sw" })], { flags: { styles: "single,twoHanded" }, system: { scores: { dex: { mod: 2 } }, details: { level: 3 } } }));
check("fully proficient loadout → no nonProficientUse state", profLo.nonProficientUse === false && !profLo.violations.some((v) => v.type === VIOLATION.NON_PROFICIENT_USE));

// Weapon Finesse swaps STR (+1) for DEX (+3) → net +2.
a = rollActor([swordItem], { flags: { styles: "single,twoHanded" }, effects: [marker("finesse", "1")], system: { scores: { str: { mod: 1 }, dex: { mod: 3 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("Weapon Finesse → +(dex−str) = +2", m && m.bonusDelta === 2);
check("Weapon Finesse does not apply to missile attacks", computeAttackMods(a, attData(swordItem), { type: "missile" })?.bonusDelta !== 2);

// Lone medium sword is wielded two-handed → damage upsized 1d6 → 1d8.
check("two-handed grip upsizes damage to 1d8", m.damage === "1d8");

// A large weapon has no 1H/2H split → no damage override.
const greatItem = weapon("Two-Handed Sword", { melee: true, id: "gs" });
a = rollActor([greatItem], { flags: { styles: "single,twoHanded" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
check("large weapon → no damage upsize", (computeAttackMods(a, attData(greatItem), { type: "melee" })?.damage ?? null) === null);

// Dual-wield base +1 is loadout-level (belongs in the effect, not the wrap).
const dualLo = getLoadout(actor([weapon("Sword", { melee: true, id: "x" }), weapon("Dagger", { melee: true, id: "y" })], { flags: { styles: "dual" } }));
const dualChanges = buildLoadoutChanges(actor([], { flags: { styles: "dual" } }), dualLo);
check("dual style → +1 melee attack in the loadout effect", dualChanges.some((c) => c.key === "system.thac0.mod.melee" && Number(c.value) === 1));

// --- Phase 4: Paper Doll slot config ----------------------------------------
// Paper Doll compiles each slot `filter` via new Function("item", body) at
// runtime, so a typo would only surface in-world. Compile the REAL config here.
const { ACKS_PAPERDOLL_CONFIG } = await import(new URL("paperdoll.mjs", S));
check("paper-doll config sets EQUIPPED_PATH so ACKS writes system.equipped", ACKS_PAPERDOLL_CONFIG.EQUIPPED_PATH === "equipped");
const slotFilter = (region, slot) => ACKS_PAPERDOLL_CONFIG.SLOTS[region][slot][0].filter;
const compile = (body) => new Function("item", body);
const pdPlate = { type: "armor", name: "Plate Armor", system: { type: "heavy" } };
const pdHelm = { type: "armor", name: "Heavy Helmet", system: { type: "medium" } };
const pdShield = { type: "armor", name: "Shield", system: { type: "shield" } };
const pdSword = { type: "weapon", name: "Sword", system: {} };
const pdRope = { type: "item", name: "Rope", system: {} };
const fBody = compile(slotFilter("LEFT", "BODY"));
const fHead = compile(slotFilter("LEFT", "HEAD"));
const fHand = compile(slotFilter("BOTTOM_RIGHT_MAIN", "MAIN_RIGHT"));
check("BODY slot: armour suit only (no helmet, no shield)", fBody(pdPlate) && !fBody(pdHelm) && !fBody(pdShield));
check("HEAD slot: helmets only", fHead(pdHelm) && !fHead(pdPlate));
check("hand slots: weapons + shields only", fHand(pdSword) && fHand(pdShield) && !fHand(pdRope) && !fHand(pdPlate));
check("both hand slots share the hand filter", slotFilter("BOTTOM_LEFT_MAIN", "MAIN_LEFT") === slotFilter("BOTTOM_RIGHT_MAIN", "MAIN_RIGHT"));

// --- Phase 5a: sample equipment + actors compendiums -------------------------
const samples = buildSamples();
check("samples build (6 shield variants + masterwork + named)", samples.length === 9);
check("every shield variant is a shield armour item with a variant flag", samples.filter((d) => d.flags["acks-equipment"].shieldVariant).every((d) => d.type === "armor" && d.system.type === "shield" && d.system.aac.value === 1));
check("sample ids 16-char + _key matches", samples.every((d) => ID.test(d._id) && d._key === `!items!${d._id}`));

const actors = buildActors();
check("4 sample characters build", actors.length === 4 && actors.every((d) => d.type === "character"));
check("actor ids 16-char + !actors! key", actors.every((d) => ID.test(d._id) && d._key === `!actors!${d._id}`));
// Embedded docs are first-class LevelDB entries: every id must be 16 chars and
// every _key must be scoped to its parent, or compilePack throws / Foundry
// mis-loads. Verified against the real compiled pack; asserted here so it stays.
const allItems = actors.flatMap((a) => a.items.map((i) => ({ a, i })));
check("embedded item keys scoped to their actor", allItems.every(({ a, i }) => ID.test(i._id) && i._key === `!actors.items!${a._id}.${i._id}`));
const allEffects = allItems.flatMap(({ a, i }) => (i.effects ?? []).map((e) => ({ a, i, e })));
check("embedded effect keys scoped to actor+item", allEffects.length > 0 && allEffects.every(({ a, i, e }) => ID.test(e._id) && e._key === `!actors.items.effects!${a._id}.${i._id}.${e._id}`));
check("embedded ids unique within each actor", actors.every((a) => new Set(a.items.map((i) => i._id)).size === a.items.length));

// The samples must actually demonstrate the automation they claim.
const swordBoard = actors.find((a) => a.name.includes("Sword & Board"));
check("sword&board carries the W&S spec marker + equipped shield", swordBoard.items.some((i) => (i.effects ?? []).some((e) => e.changes.some((c) => c.value === "weaponShield:spec"))) && swordBoard.items.some((i) => i.system.type === "shield" && i.system.equipped));
check("sword&board is trained in weaponShield", swordBoard.flags["acks-equipment"].styles.includes("weaponShield"));
const mage = actors.find((a) => a.name.includes("Mage"));
check("mage's sword is outside its weapon proficiency (demos the −1)", !mage.flags["acks-equipment"].weaponProficiency.includes("sword") && mage.items.some((i) => i.name === "Sword" && i.system.equipped));
check("every sample gear item has a name", allItems.every(({ i }) => typeof i.name === "string" && i.name.length > 0));

// --- Phase 5b: JJ shield-variant overlay -------------------------------------
const shieldItem = (name, variant, strap = "hand") =>
  armor(name, "shield", { ac: 1, id: name.replace(/\W/g, ""), flags: { shieldVariant: variant, strap } });
const wsActor = (items, spec = true) =>
  actor(items, {
    flags: { styles: "weaponShield" },
    effects: spec ? [marker("styleProficient", "weaponShield:spec")] : [],
  });

// Overlay OFF: a buckler behaves exactly like a standard shield (core's +1),
// no correction — a disabled toggle must change nothing.
SETTINGS_STATE.overlayShieldVariants = false;
let lo2 = getLoadout(wsActor([weapon("Sword", { melee: true, id: "s1" }), shieldItem("Buckler", "buckler")], false));
let ch2 = buildLoadoutChanges(wsActor([], false), lo2);
check("overlay off → no shield AC correction", !ch2.some((c) => c.key === "system.aac.mod" && Number(c.value) < 0));
check("overlay off → strapped shield still costs a hand", lo2.handsUsed === 2);

SETTINGS_STATE.overlayShieldVariants = true;
// Buckler WITHOUT Weapon & Shield Specialization grants nothing → cancel core's +1.
const noSpec = wsActor([weapon("Sword", { melee: true, id: "s2" }), shieldItem("Buckler", "buckler")], false);
lo2 = getLoadout(noSpec);
ch2 = buildLoadoutChanges(noSpec, lo2);
const acDelta = ch2.filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler without spec → −1 cancels core's shield AC", acDelta === -1);
// Buckler WITH Specialization: core's +1 stands, plus the spec's own +1.
const withSpec = wsActor([weapon("Sword", { melee: true, id: "s3" }), shieldItem("Buckler", "buckler")], true);
const acDelta2 = buildLoadoutChanges(withSpec, getLoadout(withSpec)).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("buckler with spec → +1 (spec), core's shield AC kept", acDelta2 === 1);

// A shield strapped on the BACK costs no hand, forms no Weapon & Shield style,
// and must not raise ordinary AC.
const backAct = wsActor([weapon("Sword", { melee: true, id: "s4" }), shieldItem("Auxiliary Shield", "auxiliary", "back")], true);
const backLo = getLoadout(backAct);
check("back-strapped shield costs no hand", backLo.handShields.length === 0);
check("back-strapped shield → lone sword still wielded two-handed", backLo.weapons[0].wieldTwoHanded === true);
check("back-strapped shield → style is not weaponShield", backLo.activeStyle !== "weaponShield");
const backAC = buildLoadoutChanges(backAct, backLo).filter((c) => c.key === "system.aac.mod").reduce((n, c) => n + Number(c.value), 0);
check("back-strapped shield → ordinary AC cancelled (rear-only is situational)", backAC === -1);

// A phalanx shield in hand behaves normally (+1 core, +1 spec).
const phal = wsActor([weapon("Sword", { melee: true, id: "s5" }), shieldItem("Phalanx Shield", "phalanx")], true);
const phalLo = getLoadout(phal);
check("phalanx in hand → weaponShield style, costs a hand", phalLo.activeStyle === "weaponShield" && phalLo.handsUsed === 2);
SETTINGS_STATE.overlayShieldVariants = false; // leave global state clean

// --- Phase 5b: special maneuvers overlay -------------------------------------
const { maneuverMods, MANEUVERS } = await import(new URL("overlays/maneuvers.mjs", S));
const plainActor = actor([]);
const mWhip = classifyWeapon(weapon("Whip", { melee: true }));
const mNet = classifyWeapon(weapon("Net", { melee: true }));
const mSword = classifyWeapon(weapon("Sword", { melee: true }));

check("base maneuver penalty is −4", maneuverMods(plainActor, mSword, "knockDown").attackPenalty === -4);
// Combat Trickery: −4 → −2 AND the target saves at −2.
const trick = actor([], { effects: [marker("maneuverTrickery", "knockDown")] });
let mm = maneuverMods(trick, mSword, "knockDown");
check("Combat Trickery → penalty −2 and target saves −2", mm.attackPenalty === -2 && mm.targetSaveMod === -2);
// No-save maneuver: Trickery reduces the penalty by 4 instead of 2.
const trickInc = actor([], { effects: [marker("maneuverTrickery", "incapacitate")] });
mm = maneuverMods(trickInc, mSword, "incapacitate");
check("Trickery on a no-save maneuver → penalty 0, no save mod", mm.attackPenalty === 0 && mm.targetSaveMod === 0 && MANEUVERS.incapacitate.save === null);
// Weapon qualities: Flexible (whip) +2 to disarm; Entangling (net) +2 to wrestle.
check("Flexible whip → disarm at −2", maneuverMods(plainActor, mWhip, "disarm").attackPenalty === -2);
check("Entangling net → wrestle at −2", maneuverMods(plainActor, mNet, "wrestling").attackPenalty === -2);
check("quality does not apply to an unrelated maneuver", maneuverMods(plainActor, mWhip, "overrun").attackPenalty === -4);
// Trickery and weapon quality stack: −4 +2 +2 = 0.
const trickDisarm = actor([], { effects: [marker("maneuverTrickery", "disarm")] });
check("Trickery + Flexible stack → disarm at 0", maneuverMods(trickDisarm, mWhip, "disarm").attackPenalty === 0);
// Sunder: −4 against shafts, −6 otherwise.
check("sunder −6 normally, −4 vs staff/spear/polearm", maneuverMods(plainActor, mSword, "sunder").attackPenalty === -6 && maneuverMods(plainActor, mSword, "sunder", { targetShaft: true }).attackPenalty === -4);
// Disarm: two-handed grip gives the target +4 to save.
check("disarm vs two-handed grip → target saves +4", maneuverMods(plainActor, mSword, "disarm", { targetTwoHanded: true }).targetSaveMod === 4);
// Hooked (MM) acts as Trickery for disarm, but must not double up with it.
check("hooked weapon → disarm −2, target saves −2", (() => { const r = maneuverMods(plainActor, mSword, "disarm", { hooked: true }); return r.attackPenalty === -2 && r.targetSaveMod === -2; })());
check("hooked does not stack on top of Trickery", maneuverMods(trickDisarm, mSword, "disarm", { hooked: true }).attackPenalty === -2);
check("unknown maneuver → null", maneuverMods(plainActor, mSword, "nonsense") === null);


// --- Phase 7: containers ------------------------------------------------------
const { encumbranceDelta6, contentsWeight6, overCapacity, containerReport, isContainer } =
  await import(new URL("containers.mjs", S));

const gear = (name, w6, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: over.type ?? "item",
  system: { weight6: w6, quantity: { value: over.qty ?? 1 }, subtype: over.subtype, equipped: over.equipped ?? false },
  getFlag: (_m, k) => (over.flags ?? {})[k],
  effects: [],
});
const withItems = (items) => {
  const a = actor(items);
  a.items = Object.assign(items.slice(), {
    filter: (f) => items.filter(f),
    find: (f) => items.find(f),
    // containerChain walks by id and bounds itself by the collection size.
    get: (id) => items.find((i) => i.id === id),
    size: items.length,
  });
  return a;
};

// Contents stay real items, so core's flat sum is ALREADY right for a plain
// backpack — the correction must be zero, or we'd silently change every actor.
const pack = gear("Backpack", 1, { id: "bp", flags: { container: { capacity: 4 } } });
const rope = gear("Rope", 6, { id: "rope", flags: { containedIn: "bp" } });
const rations = gear("Rations", 6, { id: "rat", flags: { containedIn: "bp" } });
const cActor = withItems([pack, rope, rations]);
check("plain backpack -> no encumbrance correction (core's flat sum is RAW)", encumbranceDelta6(cActor) === 0);
check("backpack rolls up its contents' weight", contentsWeight6(cActor, "bp") === 12);
check("backpack under capacity (2 st of 4)", !overCapacity(cActor, pack));
check("container report lists load in stone", containerReport(cActor)[0].loadStone === 2);
check("isContainer only true for flagged items", isContainer(pack) && !isContainer(rope));

const ingots = gear("Iron Ingots", 30, { id: "ing", flags: { containedIn: "bp" } });
check("backpack over capacity flagged", overCapacity(withItems([pack, ingots]), pack));

// Adventurer's harness: ignore up to 1 stone of ORDINARY gear (RR p. 142).
const harness = gear("Adventurer's Harness", 1, { id: "h", equipped: true, flags: { harness: true } });
const smalls = [gear("Flask A", 1, { id: "f1" }), gear("Flask B", 1, { id: "f2" }), gear("Torch", 1, { id: "f3" })];
check("harness ignores up to 1 stone (only 3/6 available -> -3)", encumbranceDelta6(withItems([harness, ...smalls])) === -3);
const manySmalls = Array.from({ length: 10 }, (_, i) => gear(`Item ${i}`, 1, { id: `s${i}` }));
check("harness caps its relief at exactly 1 stone", encumbranceDelta6(withItems([harness, ...manySmalls])) === -6);
check("harness cannot secure heavy items", encumbranceDelta6(withItems([harness, gear("Anvil", 12, { id: "an" })])) === 0);
const plateArm = { id: "pl", name: "Plate", type: "armor", system: { equipped: true, type: "heavy", aac: { value: 6 }, weight6: 36 }, getFlag: () => undefined, effects: [] };
check("harness gives nothing over heavy armour", encumbranceDelta6(withItems([harness, plateArm, ...smalls])) === 0);

// Bowquiver: a loaded assembly counts as 2 items, not quiver + bow + arrows.
const quiver = gear("Bowquiver", 1, { id: "bq", flags: { bowquiver: true, container: { capacity: 1 } } });
const cbow = gear("Composite Bow", 6, { id: "cb", type: "weapon", flags: { containedIn: "bq" } });
const arrows = gear("Quiver, 20 Arrows", 1, { id: "ar", flags: { containedIn: "bq" } });
check("loaded bowquiver -> RAW 2 items, not 8 (delta -6)", encumbranceDelta6(withItems([quiver, cbow, arrows])) === -6);
check("empty bowquiver -> RAW 1 item (delta 0)", encumbranceDelta6(withItems([quiver])) === 0);

// Nesting rolls up; a self-referencing pair must not hang the sheet.
const sack = gear("Small Sack", 1, { id: "sk", flags: { container: { capacity: 2 }, containedIn: "bp" } });
const inSack = gear("Gems", 3, { id: "gm", flags: { containedIn: "sk" } });
check("nested container rolls up into its parent", contentsWeight6(withItems([pack, sack, inSack]), "bp") === 4);
const loopA = gear("Loop A", 1, { id: "la", flags: { container: {}, containedIn: "lb" } });
const loopB = gear("Loop B", 1, { id: "lb", flags: { container: {}, containedIn: "la" } });
check("self-referencing containers do not hang", contentsWeight6(withItems([loopA, loopB]), "la") >= 0);


// Container profiles must match core's REAL item names in acks-adventuring-
// equipment (we annotate those in place rather than duplicating them).
const { containerProfileFor } = await import(new URL("config.mjs", S));
check("backpack profile from core's name '(holds 4 stone)'", containerProfileFor("Backpack (holds 4 stone)").capacity === 4);
check("rucksack 2 st / large sack 6 st / saddlebag 3 st", containerProfileFor("Rucksack (holds 2 stone)").capacity === 2 && containerProfileFor("Sack, Large (holds 6 stone)").capacity === 6 && containerProfileFor("Saddlebag (holds 3 stone)").capacity === 3);
check("adventurer's harness profile flags the harness rule", containerProfileFor("Adventurer's Harness").harness === true);
check("bowquiver profile flags the 2-item rule", containerProfileFor("Bowquiver").bowquiver === true);
check("a sword is not a container", containerProfileFor("Sword") === null);


// --- Phase 5b: item loss from damage (JJ p. 398) ------------------------------
SETTINGS_STATE.overlayItemLoss = true;
const { stonesAtRisk, isVulnerable, materialOf, planItemLoss, LOSS_ORDER_FRONT, LOSS_ORDER_REAR } =
  await import(new URL("overlays/item-loss.mjs", S));

check("no loss above -6 hp", stonesAtRisk(-5) === 0 && stonesAtRisk(0) === 0);
check("-6 hp risks 1 stone; each further 6 damage risks another", stonesAtRisk(-6) === 1 && stonesAtRisk(-11) === 1 && stonesAtRisk(-12) === 2 && stonesAtRisk(-18) === 3);
check("rear order is the exact reverse of the front order", LOSS_ORDER_REAR.join() === [...LOSS_ORDER_FRONT].reverse().join());

// Materials table (JJ p. 398): fire burns cloth, piercing does not; poison
// destroys nothing at all.
check("fire destroys cloth/leather/wood, not metal", isVulnerable("cloth", "fire") && isVulnerable("leather", "fire") && !isVulnerable("metal", "fire"));
check("piercing destroys only ceramic and glass", isVulnerable("glass", "piercing") && !isVulnerable("cloth", "piercing"));
check("poison destroys nothing", !isVulnerable("cloth", "poisonous") && !isVulnerable("metal", "poisonous"));
check("bludgeoning destroys metal and stone, not cloth", isVulnerable("metal", "bludgeoning") && !isVulnerable("cloth", "bludgeoning"));
check("material guessed from name (oil = combustible, holy water = good)", materialOf(gear("Oil, Military", 1)) === "combustible" && materialOf(gear("Holy Water", 1)) === "good");
check("explicit material flag beats the guess", materialOf(gear("Odd Thing", 1, { flags: { material: "glass" } })) === "glass");

// The Judges Journal's own worked example: Andravus at -18 hp from a fireball
// risks 3 stone; fire cannot touch his metal flasks of holy water or his coins,
// so those are skipped rather than consuming the budget.
const jjShield = { id: "sh", name: "Shield", type: "armor", system: { equipped: true, type: "shield", aac: { value: 1 }, weight6: 6 }, getFlag: (_m, k) => ({ material: "wood" }[k]), effects: [] };
const jjSpear = gear("Spear", 6, { id: "sp", type: "weapon", flags: { material: "wood" } });
const jjHolyWater = gear("Holy Water", 1, { id: "hw", flags: { material: "metal" } });
const jjOil = gear("Oil, Military", 1, { id: "oil" });
const jjActor = withItems([jjShield, jjSpear, jjHolyWater, jjOil]);
const jjLo = { handShields: [jjShield], armor: null };
const plan = planItemLoss(jjActor, jjLo, { hp: -18, damageType: "fire" });
check("fireball at -18 hp risks 3 stone", plan.stones === 3);
check("wooden shield in hand is destroyed first (front order)", plan.destroyed[0].item.id === "sh");
check("metal holy-water flask is skipped by fire, not destroyed", !plan.destroyed.some((d) => d.item.id === "hw") && plan.survivors >= 1);
check("the wooden spear burns too", plan.destroyed.some((d) => d.item.id === "sp"));

// Damaged from the rear the order flips: the shield in hand is now last.
const rearPlan = planItemLoss(jjActor, jjLo, { hp: -6, damageType: "fire", fromRear: true });
check("from the rear the shield is not the first thing lost", rearPlan.destroyed[0]?.item.id !== "sh");

// Poison destroys nothing regardless of how far below -6 the victim is.
check("poison at -30 hp destroys nothing", planItemLoss(jjActor, jjLo, { hp: -30, damageType: "poisonous" }).destroyed.length === 0);
SETTINGS_STATE.overlayItemLoss = false;


// --- Phase 5b: scavenged equipment (RR p. 160) --------------------------------
const { tableFor, lookup, accumulate, needsReroll, toItemUpdates, SCAVENGED_CAPS } =
  await import(new URL("overlays/scavenged.mjs", S));

check("bludgeoning weapons use their own table", tableFor(weapon("Mace", { melee: true }), { type: "bludgeoning" }) === "bludgeoning");
check("swords use the piercing/slashing table", tableFor(weapon("Sword", { melee: true }), { type: "slashing" }) === "piercingSlashing");
check("armour uses the armour/equipment table", tableFor(armor("Plate", "heavy"), {}) === "armourEquipment");
check("1-2 is serviceable at full value", lookup("piercingSlashing", 1).value === 1);
check("19-20 means roll again twice", needsReroll("piercingSlashing", 19) && needsReroll("piercingSlashing", 20) && !needsReroll("piercingSlashing", 5));

// RR's worked example: a scavenged sword rolls 19 (reroll), then 7 and 15 —
// rusty blade (-1 damage) and loose hilt (-1 initiative), value 66% of normal.
const ex = accumulate("piercingSlashing", [19, 7, 15]);
check("RR example: rusty + loose hilt -> -1 damage, -1 initiative", ex.damage === -1 && ex.initiative === -1);
check("RR example: value falls to ~66% (0.67 x 0.67)", Math.round(ex.valueMultiplier * 100) === 45 || Math.round((1 - ex.valueMultiplier) * 100) >= 33);
check("the reroll row itself contributes no penalty", !ex.labels.includes("Roll again twice"));

// Effects are cumulative but capped: attack/AC never worse than -5.
const stacked = accumulate("piercingSlashing", [11, 11, 11, 11, 11, 11, 11]);
check("attack penalty capped at -5", stacked.attack === SCAVENGED_CAPS.attack);

// Reuse first: results become updates to fields CORE already owns.
const upd = toItemUpdates(weapon("Sword", { melee: true, damage: "1d6" }), accumulate("piercingSlashing", [7]));
check("-1 damage becomes a core damage string '1d6-1'", upd["system.damage"] === "1d6-1");
const updA = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [11]));
check("-1 AC becomes a core aac.value", updA["system.aac.value"] === 5);
const updE = toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [3]));
check("+1 stone becomes core weight6 (+6 units)", updE["system.weight6"] === 6);
check("breaks/cannotSneak recorded as a flag for the Judge", toItemUpdates(armor("Plate", "heavy", { ac: 6 }), accumulate("armourEquipment", [7]))["flags.acks-equipment.scavenged"].cannotSneak === true);


// --- Class training chunks (JJ p. 290-291) ------------------------------------
const { grantMatches } = await import(new URL("proficiency.mjs", S));
const { buildTraining } = await import(new URL("../tools/pack-data.mjs", import.meta.url));

const pAxe = classifyWeapon(weapon("Battle Axe", { melee: true }));
const pSword = classifyWeapon(weapon("Sword", { melee: true }));
const pGreat = classifyWeapon(weapon("Two-Handed Sword", { melee: true }));
const pBow = classifyWeapon(weapon("Long Bow", { missile: true, melee: false }));
const pDagger = classifyWeapon(weapon("Dagger", { melee: true }));

check("token 'all' grants everything", grantMatches("all", pAxe) && grantMatches("all", pBow));
check("category token matches its category only", grantMatches("axe", pAxe) && !grantMatches("axe", pSword));
check("broad (v) missile:all grants every missile weapon", grantMatches("missile:all", pBow) && !grantMatches("missile:all", pSword));
check("broad (i) melee:medium matches a sword, not a great sword", grantMatches("melee:medium", pSword) && !grantMatches("melee:medium", pGreat));
check("broad (ii) melee:large matches a great sword", grantMatches("melee:large", pGreat));
check("restricted list grants a single named weapon", grantMatches("dagger", pDagger) && !grantMatches("dagger", pSword));

const narrowAxes = actor([], { effects: [marker("weaponProf", "axe")] });
check("a training chunk alone drives proficiency (axe yes, sword no)", isWeaponProficient(narrowAxes, pAxe) && !isWeaponProficient(narrowAxes, pSword));
check("un-configured character stays permissive", isWeaponProficient(actor([]), pAxe));
const broadThief = actor([], { effects: [marker("weaponProf", "melee:tiny,melee:small,melee:medium"), marker("weaponProf", "missile:all")] });
check("JJ thief broad selection: medium melee + all missile, not great swords", isWeaponProficient(broadThief, pSword) && isWeaponProficient(broadThief, pBow) && !isWeaponProficient(broadThief, pGreat));

const lightClass = actor([], { effects: [marker("armourProficiency", "light")] });
check("armour chunk sets the cap", armorMax(lightClass) === "light");
const lightPlusTraining = actor([], { effects: [marker("armourProficiency", "light"), marker("armorTraining", "1")] });
check("Armour Training raises a chunk-granted cap light -> medium", armorMax(lightPlusTraining) === "medium");

const dualChunk = actor([weapon("Sword", { melee: true, id: "d1" }), weapon("Dagger", { melee: true, id: "d2" })], { effects: [marker("styleProficient", "dual")] });
const dualLo2 = getLoadout(dualChunk);
check("Fighting Style chunk trains the style (dual proficient)", dualLo2.activeStyle === "dual" && dualLo2.styleProficient);
check("single + missile are mandatory even with no chunks", getLoadout(actor([weapon("Sword", { melee: true, id: "z" })])).trainedStyles.has("single"));

const training = buildTraining();
check("training pack has all 34 JJ chunks", training.length === 34);
check("training chunks are ability items with 16-char ids", training.every((d) => d.type === "ability" && ID.test(d._id)));
check("all 5 fighting styles are individually available", ["single", "missile", "dual", "twoHanded", "weaponShield"].every((st) => training.some((d) => (d.effects[0]?.changes ?? []).some((c) => c.key.endsWith("styleProficient") && c.value === st))));
check("all 5 armour rungs are individually available", ["unarmored", "veryLight", "light", "medium", "heavy"].every((a) => training.some((d) => (d.effects[0]?.changes ?? []).some((c) => c.key.endsWith("armourProficiency") && c.value === a))));
check("all 10 restricted weapons are individually available", training.filter((d) => d.name.startsWith("Restricted Weapon:")).length === 10);

// --- Named items (JJ p. 399) --------------------------------------------------
SETTINGS_STATE.overlayNamed = true;
const N = await import(new URL("overlays/named.mjs", S));
const namedRec = (over = {}) => ({
  trueName: "Fist of Iron", givenName: "Tooth-Breaker",
  ladder: ["damage", "hit", "damage", "hit", "damage", "hit"],
  unlocked: 1, revealed: false, guesses: {}, ...over,
});
const hammer = (over = {}) => ({
  id: "tb", name: over.name ?? "Tooth-Breaker", type: "weapon",
  system: { damage: "1d6", bonus: 0, equipped: true, weight6: 1 },
  getFlag: (_m, k) => (k === "named" ? namedRec(over.rec ?? {}) : undefined),
  effects: [],
});
const lvl = (n) => ({ id: "m", system: { details: { level: n } } });

check("first naming unlocks exactly one rung (+1 damage)", (() => { const b = N.unlockedBonuses(hammer()); return b.damage === 1 && b.hit === 0; })());
check("2nd rung follows the Judge ladder (+1 hit and damage)", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 2 } })); return b.damage === 1 && b.hit === 1; })());
check("Tooth-Breaker at 6 rungs is the full +3/+3", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 6 } })); return b.damage === 3 && b.hit === 3; })());
check("unlocked never exceeds the ladder length", N.unlockedCount(hammer({ rec: { unlocked: 99 } })) === 6);
check("revealed true name -> full power regardless of unlocked", (() => { const b = N.unlockedBonuses(hammer({ rec: { unlocked: 1, revealed: true } })); return b.damage === 3 && b.hit === 3; })());
check("true name match is case/space-insensitive", N.nameMatches(hammer(), "  fist of iron ") && !N.nameMatches(hammer(), "Tooth-Breaker"));
check("a character may guess once", N.canGuess(hammer(), lvl(3)));
check("a wrong guess locks that character out at their level", (() => { const r = N.resolveGuess(hammer(), lvl(3), "Wrong Name"); return r.allowed && !r.correct && r.updates["flags.acks-equipment.named.guesses"].m === 3; })());
check("cannot guess again at the same level", !N.canGuess(hammer({ rec: { guesses: { m: 3 } } }), lvl(3)));
check("gaining a level allows another guess", N.canGuess(hammer({ rec: { guesses: { m: 3 } } }), lvl(4)));
check("correct guess reveals and renames the item to its true name", (() => { const r = N.resolveGuess(hammer(), lvl(3), "Fist of Iron"); return r.correct && r.updates.name === "Fist of Iron" && r.updates["flags.acks-equipment.named.revealed"] === true; })());
check("re-naming renames the item and unlocks one rung", (() => { const u = N.renameUpdates(hammer({ rec: { unlocked: 0 } }), "Orcbiter", 1); return u.name === "Orcbiter" && u["flags.acks-equipment.named.unlocked"] === 1; })());
check("level-up advances exactly one rung", N.advanceOnLevelUp(hammer({ rec: { unlocked: 2 } }))["flags.acks-equipment.named.unlocked"] === 3);
check("a fully unlocked item does not advance further", N.advanceOnLevelUp(hammer({ rec: { unlocked: 6 } })) === null);
check("a revealed item does not advance (already full)", N.advanceOnLevelUp(hammer({ rec: { revealed: true } })) === null);
check("unlocked bonuses map onto core fields", (() => { const u = N.toItemUpdates(hammer({ rec: { unlocked: 6 } }), { bonus: 0, damage: "1d6" }); return u["system.bonus"] === 3 && u["system.damage"] === "1d6+3"; })());
SETTINGS_STATE.overlayNamed = false;


// Applying unlocked bonuses must be IDEMPOTENT: recomputed from the captured
// mundane base, so repeated level-ups cannot compound (+3 must never become +6).
SETTINGS_STATE.overlayNamed = true;
const basedHammer = (unlocked, equipped = true) => ({
  id: "tb2", name: "Tooth-Breaker", type: "weapon",
  system: { damage: "1d6+3", bonus: 3, equipped, weight6: 1 }, // already-modified values
  getFlag: (_m, k) => (k === "named" ? { trueName: "Fist of Iron", ladder: ["damage", "hit", "damage", "hit", "damage", "hit"], unlocked, revealed: false, guesses: {}, base: { bonus: 0, damage: "1d6", aac: 0, weight6: 1 } } : undefined),
  effects: [],
});
const reapplied = N.applyUpdates(basedHammer(6));
check("re-applying recomputes from base, never compounds", reapplied["system.bonus"] === 3 && reapplied["system.damage"] === "1d6+3");
check("captureBase records the mundane stats", (() => { const b = N.captureBase({ system: { bonus: 1, damage: "1d8", weight6: 6 } }); return b.bonus === 1 && b.damage === "1d8" && b.weight6 === 6; })());
check("renameUpdates captures the base on first naming", N.renameUpdates(hammer({ rec: { unlocked: 0 } }), "Orcbiter", 1)["flags.acks-equipment.named.base"] !== undefined);

// A level-up advances only WIELDED named items, one rung, restating bonuses.
const adv = N.advanceWieldedOnLevelUp({ items: [basedHammer(2)], system: { details: { level: 4 } } });
check("level-up advances a wielded named item one rung", adv.length === 1 && adv[0].updates["flags.acks-equipment.named.unlocked"] === 3);
check("advancement restates bonuses from base (3 rungs = +2 dmg, +1 hit)", adv[0].updates["system.damage"] === "1d6+2" && adv[0].updates["system.bonus"] === 1);
check("an unwielded named item does not advance", N.advanceWieldedOnLevelUp({ items: [basedHammer(2, false)], system: { details: { level: 4 } } }).length === 0);
SETTINGS_STATE.overlayNamed = false;


// --- buildApi smoke test ------------------------------------------------------
// v0.9.0-v0.12.0 shipped BROKEN: api.mjs exposed containerReport & co. that it
// never imported, so buildApi() threw a ReferenceError at init and the whole
// module died. node --check is syntax-only and nothing here called buildApi, so
// it sailed through. Actually building the API is the guard.
globalThis.Hooks = globalThis.Hooks ?? { once: () => {}, on: () => {}, callAll: () => {} };
const moduleStub = {};
globalThis.game.modules = { get: (id) => (id === "acks-equipment" ? moduleStub : { active: false }) };
const { buildApi } = await import(new URL("api.mjs", S));
const api = buildApi();
check("buildApi() runs without throwing (every exposed symbol is imported)", !!api);
check("buildApi exposes it on the module and globalThis", moduleStub.api === api && globalThis.acksEquipment === api);
for (const fn of ["getLoadout", "containerReport", "contentsOf", "contentsWeight6", "overCapacity", "isContainer", "encumbranceDelta6", "planItemLoss", "maneuverMods", "clearFromPaperDoll", "annotateItem", "refreshLoadout"]) {
  check(`api.${fn} is defined`, typeof api[fn] === "function");
}
check("api.named namespace is present", typeof api.named?.resolveGuess === "function");

// v14 AE changes must carry a string `type`, never the deprecated numeric `mode`
// shim (whose setter does Number(mode) -> NaN, silently never setting type).
const typedChanges = buildLoadoutChanges(specActor, specLo);
check("loadout AE changes use string `type`, not `mode`", typedChanges.every((c) => c.type === "add" && c.mode === undefined));
const profEffectChanges = buildProficiencies().flatMap((d) => d.effects[0]?.changes ?? []);
check("pack effect changes use string `type`, not `mode`", profEffectChanges.length > 0 && profEffectChanges.every((c) => c.type === "override" && c.mode === undefined));


// Every register* entry point runs too. These have function-body references
// that node --check cannot see — exactly how the buildApi ReferenceError hid.
const registered = [];
globalThis.game.settings.register = (_m, k) => registered.push(k);
globalThis.game.user = { isGM: false };
globalThis.libWrapper = { register: () => {} };
globalThis.CONFIG = { Actor: { documentClass: { prototype: {} } } };
const { registerSettings } = await import(new URL("settings.mjs", S));
registerSettings();
check("registerSettings() runs and registers the settings", registered.includes("enforceMode") && registered.includes("overlayNamed"));
const { registerRollWrap } = await import(new URL("roll-wrap.mjs", S));
registerRollWrap();
check("registerRollWrap() runs without throwing", true);
const { registerPaperDoll, activeStrategy } = await import(new URL("paperdoll.mjs", S));
registerPaperDoll();
check("registerPaperDoll() runs and falls back when the doll is absent", activeStrategy() === "fallback");
const { registerSheet } = await import(new URL("sheet.mjs", S));
registerSheet();
check("registerSheet() runs without throwing", true);

// Overlay toggles with NO implementation behind them must not appear in the
// settings UI — a switch that silently does nothing is worse than no switch.
for (const dead of ["overlayMounted", "overlayBeastman", "overlayEnclosingHelm"]) {
  check(`${dead} is not registered (no implementation exists)`, !registered.includes(dead));
}
for (const live of ["overlayShieldVariants", "overlayManeuvers", "overlayItemLoss", "overlayNamed", "overlayScavenged"]) {
  check(`${live} is registered and gates real code`, registered.includes(live));
}

/* ---------------------------------------------------------------------- */
/*  Containers + wear locations                                            */
/* ---------------------------------------------------------------------- */

globalThis.ui = globalThis.ui ?? { notifications: { warn: () => {}, info: () => {} } };

// (the read-only container maths — roll-up, capacity, harness, bowquiver — are
// already covered above; these cover the new MUTATION and placement layer.)
const { contentsOf, looseItems, containerChain, canStore, storeIn } =
  await import(new URL("containers.mjs", S));
const { wearLocation, wearBuckets } = await import(new URL("wear.mjs", S));
const { WEAR } = await import(new URL("config.mjs", S));

const torch = gear("Torch", 1, { id: "tor" });
const packed = withItems([pack, rope, rations, torch]);

check("contentsOf finds the stowed gear", contentsOf(packed, "bp").length === 2);
check("looseItems excludes stowed gear", looseItems(packed).map((i) => i.id).sort().join() === "bp,tor");

// Over capacity is a WARNING, never a block — RAW capacity does not alter weight.
check("canStore still allows overfilling (capacity warns, never blocks)",
  canStore(withItems([pack, ingots]), torch, pack).ok);

// Nesting: a chest holding a backpack holding rations rolls all the way up.
const chest = gear("Chest", 6, { id: "ch", flags: { container: { capacity: 20 } } });
const innerPack = gear("Backpack", 1, { id: "bp2", flags: { container: { capacity: 4 }, containedIn: "ch" } });
const inRations = gear("Rations", 6, { id: "r2", flags: { containedIn: "bp2" } });
const nested = withItems([chest, innerPack, inRations]);
check("nested contents roll up through the chain", contentsWeight6(nested, "ch") === 7);
check("containerChain walks outward", containerChain(nested, inRations).map((c) => c.id).join() === "bp2,ch");
check("a container may not go inside its own contents", !canStore(nested, innerPack, innerPack).ok);
check("cycles are refused", !canStore(nested, chest, innerPack).ok);
check("a legal nesting is allowed", canStore(nested, torch, innerPack).ok);
check("an item cannot be put inside itself", !canStore(packed, pack, pack).ok);
check("a non-container is not a valid target", !canStore(packed, torch, rope).ok);

// The roll-up already guards against a data cycle (above); the chain walk needs
// its own bound, or a sheet with corrupt flags would hang the client.
check("containerChain terminates on a cycle", containerChain(withItems([loopA, loopB]), loopA).length <= 2);

// storeIn: refuses the impossible, and takes worn gear off before stowing it.
let stored = null;
const wornCloak = { ...gear("Cloak", 1, { id: "cl", equipped: true }), update: async (u) => { stored = u; } };
const stowActor = withItems([pack, wornCloak]);
check("storeIn refuses a non-container target", (await storeIn(stowActor, wornCloak, torch)) === false);
check("storeIn stows the item", (await storeIn(stowActor, wornCloak, pack)) === true);
check("storeIn writes the containedIn flag", stored?.["flags.acks-equipment.containedIn"] === "bp");
check("stowing worn gear unequips it first", stored?.["system.equipped"] === false);

// The Container Manager's context is the whole feature's data path — build it.
const { default: ContainerManager } = await import(new URL("apps/container-manager.mjs", S));
const cmCtx = await new ContainerManager(packed, { id: "cm" })._prepareContext();
check("container app lists the containers", cmCtx.containers.length === 1 && cmCtx.hasContainers);
check("container app shows the load label", cmCtx.containers[0].label === "2 / 4 st");
check("container app lists the contents", cmCtx.containers[0].contents.length === 2);
check("container app lists loose gear separately", cmCtx.loose.map((i) => i.id).join() === "tor");
check("container app flags gear whose name matches a RAW carrying device",
  (await new ContainerManager(withItems([gear("Backpack", 1, { id: "b3" })]), { id: "cm2" })._prepareContext())
    .loose[0].suggestible);

// --- wear locations ---
const helm = armor("Helmet", "light", { id: "hm" });
const plate = armor("Plate Mail", "heavy", { id: "pm" });
const shield = armor("Shield", "shield", { id: "sd" });
const blade = weapon("Sword", { melee: true, id: "sw" });
const offBlade = weapon("Dagger", { melee: true, id: "dg", flags: { hand: "off" } });
const spare = weapon("Handaxe", { melee: true, id: "hx", equipped: false });
const stowedRope = gear("Rope", 6, { id: "rp", flags: { containedIn: "bp" } });
const dressed = withItems([helm, plate, shield, blade, offBlade, spare, pack, stowedRope]);
const dLo = getLoadout(dressed);

check("a helmet is worn on the head", wearLocation(dressed, helm, dLo) === WEAR.HEAD);
check("a suit of armour is worn on the body", wearLocation(dressed, plate, dLo) === WEAR.BODY);
check("a shield in hand is in the off hand", wearLocation(dressed, shield, dLo) === WEAR.OFF_HAND);
check("an unflagged weapon is in the main hand", wearLocation(dressed, blade, dLo) === WEAR.MAIN_HAND);
check("the hand flag puts a weapon in the off hand", wearLocation(dressed, offBlade, dLo) === WEAR.OFF_HAND);
check("unequipped gear is merely carried", wearLocation(dressed, spare, dLo) === WEAR.CARRIED);
check("gear inside a container is stowed", wearLocation(dressed, stowedRope, dLo) === WEAR.STOWED);

// A lone medium weapon with both hands free is wielded two-handed (RR p. 299),
// and the wear bucket must agree with the loadout that says so.
const soloBlade = weapon("Sword", { melee: true, id: "sw2" });
const twoHanded = withItems([soloBlade]);
const tLo = getLoadout(twoHanded);
check("the loadout wields a lone medium weapon two-handed", tLo.weapons[0].wieldTwoHanded);
check("wear agrees: both hands", wearLocation(twoHanded, soloBlade, tLo) === WEAR.BOTH_HANDS);

const buckets = wearBuckets(dressed, dLo);
check("buckets are display-ordered head first", buckets[0].key === WEAR.HEAD);
check("buckets omit empty locations", buckets.every((b) => b.items.length > 0));
check("carried and stowed gear stays out of the worn buckets",
  !buckets.some((b) => b.items.some((i) => i.id === "hx" || i.id === "rp")));
check("every equipped item lands in exactly one bucket",
  buckets.reduce((n, b) => n + b.items.length, 0) === 5);

/* ---------------------------------------------------------------------- */
/*  Proficiency kill switch (acks-abilities interop)                        */
/* ---------------------------------------------------------------------- */

// This module infers proficiency from its OWN actor flags. acks-abilities owns
// a richer model of the same facts, so a character built with it carries none
// of these flags and would read as non-proficient — triggering the full RR
// p. 106 package on a legal PC. Enforcement must default OFF while it is active.
const { enforcementActive } = await import(new URL("proficiency.mjs", S));

// A bare unconfigured actor with a weapon its (absent) flags don't cover.
const unconfigured = () => withItems([weapon("Halberd", { melee: true, id: "hb" })]);

const setModules = (activeIds) => {
  globalThis.game.modules = { get: (id) => ({ active: activeIds.includes(id) }) };
};
const setMode = (mode) => {
  const base = globalThis.game.settings.get;
  globalThis.game.settings.get = (m, k) =>
    k === "proficiencyEnforcement" ? mode : base(m, k);
};

// Baseline: no acks-abilities → enforcement live, penalties as before.
setModules([]);
setMode("auto");
check("auto + abilities absent → enforcement LIVE", enforcementActive());
check("baseline: unconfigured actor is still gated", getLoadout(unconfigured()).nonProficientUse);

// The hotfix: acks-abilities present → penalties off, no silent 0th-level hit.
setModules(["acks-abilities"]);
check("auto + abilities ACTIVE → enforcement OFF", !enforcementActive());
const freed = getLoadout(unconfigured());
check("kill switch clears nonProficientUse", !freed.nonProficientUse);
check("kill switch reports weapons proficient", freed.weapons.every((w) => w.proficient));
check("kill switch reports the style trained", freed.styleProficient);
check("kill switch raises no proficiency violations",
  !freed.violations.some((v) => ["weaponNotProficient", "armorNotProficient", "styleNotProficient", "nonProficientUse"].includes(v.type)));
// The attack package is what actually hurt a PC — prove it is gone.
const freedMods = computeAttackMods(
  { ...freed, ...unconfigured(), type: "character", system: { details: { level: 5 }, thac0: { bba: 3 }, scores: { str: { mod: 2 } } } },
  { item: { _id: "hb", system: { bonus: 0 } } },
  { type: "melee" },
);
check("kill switch removes the attack degradation", !freedMods || freedMods.bonusDelta === 0);

// Equip limits are NOT proficiency — they must survive the kill switch.
const overloaded2 = withItems([weapon("Sword", { melee: true, id: "s1" }), weapon("Axe", { melee: true, id: "s2" }), weapon("Mace", { melee: true, id: "s3" })]);
check("kill switch does NOT disable hand-limit enforcement",
  getLoadout(overloaded2).violations.some((v) => v.type === "handOverflow"));

// Explicit overrides win in both directions.
setMode("on");
check("mode 'on' enforces even with abilities active", enforcementActive());
setModules([]);
setMode("off");
check("mode 'off' disables even with abilities absent", !enforcementActive());

// Restore defaults for anything that runs later.
setMode("auto");

/* ---------------------------------------------------------------------- */
/*  Abilities bridge — proficiency facts FROM the acks-abilities model      */
/* ---------------------------------------------------------------------- */

const { hasEffectFlag, sumEffectModifiers } = await import(new URL("effects.mjs", S));
const { trainedStyles, specializedStyles } = await import(new URL("loadout.mjs", S));
const { resolveStylePick, resolveWeaponGroupPick, resolveFocusPick } =
  await import(new URL("abilities-bridge.mjs", S));

/** An abilities-modelled ability item: cookbook id + extras, NO native AEs. */
const abil = (name, defId, extras = {}, over = {}) => ({
  id: over.id ?? name.replace(/\W/g, ""),
  name,
  type: "ability",
  system: {},
  flags: {
    ...(defId ? { "acks-content": { cookbook: { id: defId } } } : {}),
    "acks-abilities": { extras },
  },
  getFlag: () => undefined,
  effects: over.effects ?? [],
});

// Presence via cookbook id → boolean domain (no equipment flags anywhere).
const finesseChar = withItems([abil("Weapon Finesse", "def.prof.weaponFinesse")]);
check("bridge: cookbook id flips the finesse domain", hasEffectFlag(finesseChar, "finesse"));
check("bridge: absent ability, absent domain", !hasEffectFlag(withItems([]), "finesse"));

// FSS with a stored pick → trained AND specialized in that style, without any
// flags.acks-equipment.* data — the exact character the kill switch protected.
const fss = abil("Fighting Style Specialization", "def.prof.fightingStyleSpecialization", { selections: ["Two-Handed"] });
const fssChar = withItems([fss, weapon("Sword", { melee: true, id: "fsw" })]);
check("bridge: FSS pick trains the style", trainedStyles(fssChar).has("twohanded"));
check("bridge: FSS pick specializes the style", specializedStyles(fssChar).has("twohanded"));
check("bridge: FSS character is styleProficient under FULL enforcement",
  getLoadout(fssChar).styleProficient && getLoadout(fssChar).nonProficientUse === false);

// Martial Training pick widens weapon proficiency under full enforcement.
// (Actor narrowed to swords so the test cannot pass vacuously.)
const mtChar = withItems([abil("Martial Training", "def.prof.martialTraining", { selections: ["Axes"] })]);
mtChar.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: Martial Training (Axes) grants the axe category",
  isWeaponProficient(mtChar, classifyWeapon(weapon("Battle Axe", { melee: true }))));
const noMt = withItems([]);
noMt.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: without it the axe stays non-proficient",
  !isWeaponProficient(noMt, classifyWeapon(weapon("Battle Axe", { melee: true }))));

// Armour Training: each rank raises the wearable category one step.
const atChar = withItems([abil("Armor Training", "def.prof.armorTraining", { qty: 2 })]);
atChar.getFlag = (_m, k) => (k === "armorMax" ? "light" : undefined);
check("bridge: Armor Training rank 2 raises light → heavy", armorMax(atChar) === "heavy");
check("bridge: US and UK spellings both resolve",
  sumEffectModifiers(withItems([abil("Armour Training", null, { qty: 1 })]), "armorTraining") === 1);

// Name-suffix fallback: a hand-made item with no extras still carries its pick.
const suffix = withItems([abil("Martial Training (Axes)", null, {})]);
suffix.getFlag = (_m, k) => (k === "weaponProficiency" ? "swordDagger" : undefined);
check("bridge: '(X)' name suffix works with no stored selections",
  isWeaponProficient(suffix, classifyWeapon(weapon("Battle Axe", { melee: true }))));

// Dedup: an item speaking the native effect language stands aside — its AE
// counts once, the bridge adds nothing on top.
const nativeReflexes = abil("Combat Reflexes", null, {}, {
  effects: [{ changes: [{ key: "flags.acks-equipment.styleInit", value: "1" }] }],
});
const reflexChar = withItems([nativeReflexes]);
reflexChar.appliedEffects = [marker("styleInit", 1)];
check("bridge: native-effect items are not double-counted",
  sumEffectModifiers(reflexChar, "styleInit") === 1);
// The same ability WITHOUT native effects bridges to the same value.
check("bridge: pure abilities item contributes the same +1",
  sumEffectModifiers(withItems([abil("Combat Reflexes", null, {})]), "styleInit") === 1);

// Pick resolvers.
check("resolveStylePick handles 'Weapon and Shield'", resolveStylePick("Weapon and Shield") === "weaponshield");
check("resolveWeaponGroupPick: crossbows before bows", resolveWeaponGroupPick("Crossbows") === "crossbow");
check("resolveWeaponGroupPick: a named weapon passes through", resolveWeaponGroupPick("Sword") === "sworddagger" || resolveWeaponGroupPick("Whip") === "whip");
check("resolveFocusPick maps bows and crossbows together", resolveFocusPick("Bows & Crossbows") === "bowscrossbows");

/* ---------------------------------------------------------------------- */
/*  Paper Doll placement planner (sheet → doll mirror)                      */
/* ---------------------------------------------------------------------- */

const { planDollSlot } = await import(new URL("paperdoll.mjs", S));

const uSword = { ...weapon("Sword", { melee: true, id: "psw" }), uuid: "u-sw" };
const uAxe = { ...weapon("Axe", { melee: true, id: "pax" }), uuid: "u-ax" };
const uShield = { ...armor("Shield", "shield", { id: "psh" }), uuid: "u-sh" };
const uHelm = { ...armor("Helmet", "light", { id: "phm" }), uuid: "u-hm" };
const uPlate = { ...armor("Plate", "heavy", { id: "ppl" }), uuid: "u-pl" };
const uBoots = { ...gear("Boots", 1, { id: "pbt", equipped: true, subtype: "clothing" }), uuid: "u-bt" };
const uSpare = { ...weapon("Club", { melee: true, id: "pcl", equipped: false }), uuid: "u-cl" };
const dollActor = withItems([uSword, uAxe, uShield, uHelm, uPlate, uBoots, uSpare]);
const byUuid = Object.fromEntries([uSword, uAxe, uShield, uHelm, uPlate, uBoots, uSpare].map((i) => [i.uuid, { ...i, parent: { id: dollActor.id } }]));
const rsv = (u) => byUuid[u] ?? null;

check("doll plan: helmet -> HEAD", planDollSlot(dollActor, uHelm, {}, rsv) === "HEAD");
check("doll plan: suit -> BODY", planDollSlot(dollActor, uPlate, {}, rsv) === "BODY");
check("doll plan: first weapon -> MAIN_RIGHT", planDollSlot(dollActor, uSword, {}, rsv) === "MAIN_RIGHT");
check("doll plan: second weapon spills to MAIN_LEFT",
  planDollSlot(dollActor, uAxe, { MAIN_RIGHT: { 0: "u-sw" } }, rsv) === "MAIN_LEFT");
check("doll plan: shield prefers the off hand", planDollSlot(dollActor, uShield, {}, rsv) === "MAIN_LEFT");
check("doll plan: already placed stays put",
  planDollSlot(dollActor, uSword, { MAIN_RIGHT: { 0: "u-sw" } }, rsv) === "MAIN_RIGHT");
check("doll plan: a stale (unequipped) occupant does not block the slot",
  planDollSlot(dollActor, uSword, { MAIN_RIGHT: { 0: "u-cl" } }, rsv) === "MAIN_RIGHT");
check("doll plan: boots route to BOOTS", planDollSlot(dollActor, uBoots, {}, rsv) === "BOOTS");
check("doll plan: unequipped gear has no slot", planDollSlot(dollActor, uSpare, {}, rsv) === null);
check("doll plan: both hands full -> leave the player's placement alone",
  planDollSlot(dollActor, uAxe, { MAIN_RIGHT: { 0: "u-sw" }, MAIN_LEFT: { 0: "u-sh" } }, rsv) === null);

console.log(`test-logic: all ${pass} checks passed`);
