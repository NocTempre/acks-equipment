/* global game, globalThis */
/**
 * Public API — exposed on `game.modules.get("acks-equipment").api` and mirrored
 * on `globalThis.acksEquipment`. Lets sibling modules read the loadout the way
 * they read each other's data today (formation reads equipped weapons; henchmen
 * reads gear), and lets macros drive equip/annotate/purchase.
 */
import { MODULE_ID, HOOKS, EFFECT_DOMAINS, ITEM_FLAGS } from "./constants.mjs";
import { getLoadout, VIOLATION, trainedStyles, specializedStyles, handBudget } from "./loadout.mjs";
import { classifyWeapon, handCost, focusGroup, weaponKey } from "./profiles.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, isArmorProficient, thiefSkillsGated, isArmorGatedSkill } from "./proficiency.mjs";
import { refreshLoadout } from "./enforce.mjs";
import { collectEffectModifiers, sumEffectModifiers, collectStringFlags, hasEffectFlag } from "./effects.mjs";
import * as CONFIG_DATA from "./config.mjs";

/** Stamp module weapon-profile flags onto a core item from its RAW profile. */
export async function annotateItem(item) {
  if (item?.type !== "weapon") return null;
  const key = weaponKey(item);
  if (!key) return null;
  const base = CONFIG_DATA.WEAPONS[key];
  const updates = {
    [`flags.${MODULE_ID}.${ITEM_FLAGS.SIZE}`]: base.size,
    [`flags.${MODULE_ID}.${ITEM_FLAGS.DAMAGE_TYPE}`]: base.type || "",
    [`flags.${MODULE_ID}.${ITEM_FLAGS.HANDY}`]: !!base.handy,
    [`flags.${MODULE_ID}.${ITEM_FLAGS.THROWN}`]: !!base.thrown,
  };
  await item.update(updates);
  return key;
}

export function buildApi() {
  const api = {
    // Model
    getLoadout,
    handBudget,
    trainedStyles,
    specializedStyles,
    VIOLATION,
    // Profiles
    classifyWeapon,
    handCost,
    focusGroup,
    weaponKey,
    annotateItem,
    refreshLoadout,
    // Proficiency
    weaponProficiency,
    isWeaponProficient,
    armorMax,
    isArmorProficient,
    thiefSkillsGated,
    isArmorGatedSkill,
    // Effect contract
    collectEffectModifiers,
    sumEffectModifiers,
    collectStringFlags,
    hasEffectFlag,
    EFFECT_DOMAINS,
    // Data + constants
    config: CONFIG_DATA,
    HOOKS,
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  globalThis.acksEquipment = api;
  return api;
}
