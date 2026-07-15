/* global game, foundry */
/**
 * Data-driven modifier discovery + the module-managed "Equipment Loadout"
 * Active Effect.
 *
 * Mechanics live as Active Effect changes keyed `flags.acks-equipment.<domain>`
 * on `ability`/`weapon`/`armor` items (mirrors acks-henchmen). The collector
 * below reads them. The loadout AE translates the applicable ones — plus the
 * fighting-style-conditional Specialization bonuses — into changes on the real
 * core fields (`system.aac.mod`, `system.initiative.mod`, `system.thac0.mod.*`,
 * `system.damage.mod.melee`) so core's own computeAC/rollAttack consume them
 * with zero patching.
 */
import { EFFECT_PREFIX, MODULE_ID, EFFECT_DOMAINS, LOADOUT_EFFECT_NAME, LOADOUT_EFFECT_FLAG } from "./constants.mjs";
import { STYLE_SPEC_BONUS, STYLE, DUAL_WIELD_ATTACK_BONUS } from "./config.mjs";
import { shieldACCorrection, specApplies } from "./overlays/shield-variants.mjs";

/** All active effects on the actor, tolerant of Foundry version differences. */
function appliedEffects(actor) {
  if (!actor) return [];
  if (Array.isArray(actor.appliedEffects)) return actor.appliedEffects;
  return Array.from(actor.effects ?? []);
}

function localize(key) {
  try {
    return key && game?.i18n?.has?.(key) ? game.i18n.localize(key) : (key ?? "");
  } catch {
    return key ?? "";
  }
}

function effectMeta(effect) {
  const flags = effect.flags?.[MODULE_ID] ?? {};
  return {
    label: flags.label ?? effect.name ?? "",
    condition: flags.condition ? localize(flags.condition) : null,
    target: flags.target ? localize(flags.target) : null,
  };
}

/**
 * Collect every modifier an actor's effects contribute to one numeric domain.
 * @returns {{id,label,value,situational,condition,source}[]}
 */
export function collectEffectModifiers(actor, domain) {
  const found = [];
  const key = `${EFFECT_PREFIX}${domain}`;
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value) || value === 0) continue;
      const meta = effectMeta(effect);
      found.push({
        id: `fx-${effect.id ?? foundry.utils.randomID()}-${domain}`,
        label: meta.target ? `${meta.label} (${meta.target})` : meta.label,
        value,
        situational: !!meta.condition,
        condition: meta.condition,
        source: "effect",
      });
    }
  }
  return found;
}

/** Sum the always-on (non-situational) modifiers of a numeric domain. */
export function sumEffectModifiers(actor, domain) {
  return collectEffectModifiers(actor, domain)
    .filter((m) => !m.situational)
    .reduce((sum, m) => sum + m.value, 0);
}

/** True when any active effect contributes to the domain. */
export function hasEffectFlag(actor, domain) {
  const key = `${EFFECT_PREFIX}${domain}`;
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    if ((effect.changes ?? []).some((c) => c.key === key)) return true;
  }
  return false;
}

/** Collect CSV string flags of a domain into a lowercased Set. */
export function collectStringFlags(actor, domain) {
  const out = new Set();
  const key = `${EFFECT_PREFIX}${domain}`;
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      String(change.value ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((s) => out.add(s));
    }
  }
  return out;
}

/**
 * Compute the loadout Active Effect changes for the current loadout.
 * Style-Specialization bonuses apply only when their style is the ACTIVE style;
 * flat init (Combat Reflexes) applies always. Returns AE `changes` entries.
 * @param {Actor} actor
 * @param {import("./loadout.mjs").Loadout} loadout
 */
export function buildLoadoutChanges(actor, loadout) {
  // v14 change modes are lowercase string keys of CONST.ACTIVE_EFFECT_CHANGE_TYPES
  // (the numbers in that enum are default priorities, not mode values). The
  // module requires Foundry v14+, so the string literal is canonical; using the
  // deprecated numeric CONST.ACTIVE_EFFECT_MODES would log a compatibility warning.
  const ADD = "add";
  const changes = [];
  const add = (key, value) => {
    if (value) changes.push({ key, mode: ADD, value: String(value), priority: 20 });
  };

  // Fighting Style Specialization — only for the active style, if trained in it.
  const specStyles = collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT); // stores "single:spec" etc handled below
  const spec = new Set();
  for (const s of specStyles) {
    const [style, kind] = s.split(":");
    if (kind === "spec") spec.add(style);
  }
  // spec keys come from collectStringFlags lowercased; activeStyle is camelCase.
  // specApplies() withholds the Weapon & Shield bonus when the JJ overlay says
  // the shield can't take it (strapped on the back/front rather than in hand).
  if (loadout.activeStyle && spec.has(loadout.activeStyle.toLowerCase()) && specApplies(loadout)) {
    const bonus = STYLE_SPEC_BONUS[loadout.activeStyle] ?? {};
    add("system.aac.mod", bonus.ac);
    add("system.initiative.mod", bonus.init);
    add("system.thac0.mod.melee", bonus.attackMelee);
    add("system.thac0.mod.missile", bonus.attackMissile);
    add("system.damage.mod.melee", bonus.damageMelee);
  }

  // Base dual-weapon bonus: RAW grants +1 to the melee attack throw simply for
  // having a second weapon (RR p. 296) — independent of Specialization, which
  // adds its own +1 above. Untrained use still takes the −1 non-proficiency
  // penalty, applied per-weapon in roll-wrap.mjs.
  if (loadout.activeStyle === STYLE.DUAL) add("system.thac0.mod.melee", DUAL_WIELD_ATTACK_BONUS);

  // Flat always-on init (Combat Reflexes) and AC domains that are NOT style-gated.
  add("system.initiative.mod", sumEffectModifiers(actor, EFFECT_DOMAINS.STYLE_INIT));
  add("system.thac0.mod.melee", sumEffectModifiers(actor, EFFECT_DOMAINS.STYLE_ATTACK_MELEE));
  add("system.thac0.mod.missile", sumEffectModifiers(actor, EFFECT_DOMAINS.STYLE_ATTACK_MISSILE));
  add("system.aac.mod", sumEffectModifiers(actor, EFFECT_DOMAINS.STYLE_AC));

  // Conditional AC (Swashbuckling / Blade-Dancing) computed in the loadout.
  add("system.aac.mod", loadout.condAC ?? 0);

  // JJ shield-variant overlay: core's computeAC adds any equipped shield's AC
  // unconditionally. Where RAW grants none (a buckler without Specialization, or
  // a shield strapped on the back), cancel it rather than fight core.
  add("system.aac.mod", shieldACCorrection(loadout, spec.has(STYLE.WEAPON_SHIELD.toLowerCase())));

  return changes;
}

/** Stable hash of an AE changes array for dedupe. */
function changesHash(changes) {
  return JSON.stringify(changes.map((c) => [c.key, c.mode, c.value]).sort());
}

/** Find the module-managed loadout effect on an actor, if any. */
export function findLoadoutEffect(actor) {
  return actor.effects.find((e) => e.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG) === true) ?? null;
}

/**
 * Create/update/delete the managed loadout Active Effect to match the computed
 * changes. No-ops when unchanged. Only runs where the user may modify the actor;
 * otherwise a GM client handles it (see module.mjs primary-GM routing).
 * @returns {Promise<void>}
 */
export async function syncLoadoutEffect(actor, loadout) {
  if (!actor?.isOwner) return;
  const changes = buildLoadoutChanges(actor, loadout);
  const existing = findLoadoutEffect(actor);

  if (!changes.length) {
    if (existing) await existing.delete();
    return;
  }

  const desired = {
    name: LOADOUT_EFFECT_NAME,
    icon: "icons/svg/upgrade.svg",
    img: "icons/svg/upgrade.svg",
    changes,
    transfer: false,
    disabled: false,
    flags: { [MODULE_ID]: { [LOADOUT_EFFECT_FLAG]: true } },
  };

  if (!existing) {
    await actor.createEmbeddedDocuments("ActiveEffect", [desired]);
    return;
  }
  if (changesHash(existing.changes ?? []) !== changesHash(changes)) {
    await existing.update({ changes, disabled: false });
  }
}
