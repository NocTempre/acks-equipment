/**
 * Pure-logic regression tests for the loadout model and effect builder.
 * Mocks the minimal Foundry globals and imports the real scripts, so bugs that
 * a running Foundry would surface (deprecated globals, case mismatches, wrong
 * hand costs, mis-detected violations) fail the release instead.
 *
 * Run: npm test
 */
import assert from "node:assert";

globalThis.game = {
  settings: { get: (_m, k) => (k === "defaultHandBudget" ? 2 : k === "enforceMode" ? "resolve" : undefined) },
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

console.log(`test-logic: all ${pass} checks passed`);
