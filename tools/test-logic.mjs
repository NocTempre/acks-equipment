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
// v14 string-typed change modes; make the deprecated getter THROW so any access
// to CONST.ACTIVE_EFFECT_MODES fails the test.
globalThis.CONST = { ACTIVE_EFFECT_CHANGE_TYPES: { ADD: "add", OVERRIDE: "override" } };
Object.defineProperty(globalThis.CONST, "ACTIVE_EFFECT_MODES", {
  get() { throw new Error("accessed deprecated CONST.ACTIVE_EFFECT_MODES"); },
});

const S = new URL("../scripts/", import.meta.url);
const { classifyWeapon, handCost } = await import(new URL("profiles.mjs", S));
const { getLoadout, VIOLATION } = await import(new URL("loadout.mjs", S));
const { buildLoadoutChanges } = await import(new URL("effects.mjs", S));

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
  effects: over.effects ?? [],
  appliedEffects: over.effects ?? [],
  isOwner: true,
  getFlag: (_m, k) => (over.flags ?? {})[k],
});

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

console.log(`test-logic: all ${pass} checks passed`);
