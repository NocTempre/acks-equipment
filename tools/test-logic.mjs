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
globalThis.foundry = {
  utils: {
    deepClone: (x) => JSON.parse(JSON.stringify(x)),
    randomID: () => "rand0000",
    hasProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o) !== undefined,
    getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o),
  },
};
// v14: change.mode is a lowercase string key; the enum numbers are default
// priorities. Make the deprecated numeric getter THROW so any access fails.
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
check("W&S spec → +1 aac.mod, string mode 'add'", ac && Number(ac.value) === 1 && ac.mode === "add");

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
check("effect change keys are flags.acks-equipment.* with override mode", changeKeys.length > 0 && changeKeys.every((k) => k.startsWith("flags.acks-equipment.")) && profs.every((d) => (d.effects[0]?.changes ?? []).every((c) => c.mode === "override")));
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

// Non-proficient weapon → −1 (applied once).
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single,twoHanded" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
let m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("non-proficient weapon → −1", m && m.bonusDelta === -1);

// Untrained style also → −1, and never stacks to −2 with the weapon penalty.
a = rollActor([swordItem], { flags: { weaponProficiency: "axe", styles: "single" }, system: { scores: { str: { mod: 1 }, dex: { mod: 1 } } } });
m = computeAttackMods(a, attData(swordItem), { type: "melee" });
check("weapon+style both untrained → still only −1", m.bonusDelta === -1);

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
  a.items = Object.assign(items.slice(), { filter: (f) => items.filter(f), find: (f) => items.find(f) });
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

console.log(`test-logic: all ${pass} checks passed`);
