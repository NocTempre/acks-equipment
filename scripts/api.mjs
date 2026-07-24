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
import { planItemLoss, stonesAtRisk, isVulnerable, materialOf } from "./overlays/item-loss.mjs";
import { maneuverMods, MANEUVERS } from "./overlays/maneuvers.mjs";
import * as named from "./overlays/named.mjs";
import { clearFromPaperDoll } from "./paperdoll.mjs";
import {
  containerReport,
  contentsOf,
  contentsWeight6,
  overCapacity,
  isContainer,
  encumbranceDelta6,
  looseItems,
  containerChain,
  canStore,
  storeIn,
  takeOut,
  emptyContainer,
} from "./containers.mjs";
import { isLocked, isConcealed, isFragile, canSeeInside, setLocked, setOpened, setConcealed } from "./containers.mjs";
import { pickLock, bashOpen, destroyContainer, canPick, canBash } from "./locks.mjs";
import { collectEffectModifiers, sumEffectModifiers, collectStringFlags, hasEffectFlag } from "./effects.mjs";
import { bridgeContributions } from "./abilities-bridge.mjs";
import * as CONFIG_DATA from "./config.mjs";

/**
 * Stamp module profile flags onto a core item from its RAW profile.
 * Handles weapons (size/qualities) and carrying devices (container capacity,
 * harness, bowquiver) — core already ships both, so we annotate in place rather
 * than duplicate them into our own packs.
 * @returns {string|null} the profile key applied, or null if unrecognised
 */
export async function annotateItem(item) {
  if (item?.type === "weapon") {
    const key = weaponKey(item);
    if (!key) return null;
    const base = CONFIG_DATA.WEAPONS[key];
    await item.update({
      [`flags.${MODULE_ID}.${ITEM_FLAGS.SIZE}`]: base.size,
      [`flags.${MODULE_ID}.${ITEM_FLAGS.DAMAGE_TYPE}`]: base.type || "",
      [`flags.${MODULE_ID}.${ITEM_FLAGS.HANDY}`]: !!base.handy,
      [`flags.${MODULE_ID}.${ITEM_FLAGS.THROWN}`]: !!base.thrown,
    });
    return key;
  }
  if (item?.type === "item") {
    const profile = CONFIG_DATA.containerProfileFor(item.name);
    if (!profile) return null;
    const updates = {};
    if (profile.capacity) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINER}`] = { capacity: profile.capacity };
    if (profile.harness) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.HARNESS}`] = true;
    if (profile.bowquiver) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.BOWQUIVER}`] = true;
    if (!Object.keys(updates).length) return null;
    await item.update(updates);
    return "container";
  }
  return null;
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
    // Overlays
    planItemLoss,
    stonesAtRisk,
    isVulnerable,
    materialOf,
    maneuverMods,
    MANEUVERS,
    named, // JJ p.399 named arms & armour: true name, guessing, unlock ladder
    clearFromPaperDoll,
    // Containers
    containerReport,
    contentsOf,
    contentsWeight6,
    overCapacity,
    isContainer,
    encumbranceDelta6,
    looseItems,
    containerChain,
    canStore,
    storeIn,
    takeOut,
    emptyContainer,
    // Locks and concealment. `openContainerManager` is GONE — the popout it
    // opened is retired; its controls live on the character sheet's equipment
    // tab, next to the gear they act on.
    isLocked,
    isConcealed,
    isFragile,
    canSeeInside,
    setLocked,
    setOpened,
    setConcealed,
    pickLock,
    bashOpen,
    destroyContainer,
    canPick,
    canBash,
    // Effect contract
    collectEffectModifiers,
    sumEffectModifiers,
    collectStringFlags,
    hasEffectFlag,
    bridgeContributions, // proficiency facts read from the acks-abilities model
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
