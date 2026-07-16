/* global game */
/**
 * Overlay: JJ shield variants (Judges Journal pp. 407–408; acks-rules/acks-equipment/RULES.md §4).
 * Gated by the `overlayShieldVariants` world setting; off → every shield is the
 * standard +1 AC shield core already models.
 *
 * Two RAW facts drive the automation, and core models neither:
 *
 *  1. A **strapped** shield (back/front) is not in a hand. It therefore costs no
 *     hand, cannot form the Weapon & Shield fighting style, and cannot take that
 *     style's Specialization. Its AC applies only situationally (a back shield
 *     protects against attacks from behind), so it must NOT raise ordinary AC.
 *  2. A **buckler** grants its +1 AC *only* to a character with Fighting Style
 *     Specialization (Weapon & Shield). Others gain nothing at all.
 *
 * Core's computeAC adds any equipped shield's `aac.value` unconditionally, so
 * where RAW says the shield gives nothing we contribute a negative correction to
 * `system.aac.mod` — cancelling core's bonus rather than fighting it.
 *
 * Not automated (situational, needs per-attack context the system doesn't model):
 * "no benefit while vulnerable", the mounted self-or-mount choice, and the
 * phalanx shield counting for the Defend action. Those are surfaced in the item
 * descriptions for the Judge.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { SHIELD_VARIANTS, STYLE } from "../config.mjs";

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_SHIELD_VARIANTS);
}

/** The variant profile for a shield item ("standard" when unflagged/disabled). */
export function variantOf(item) {
  if (!overlayEnabled()) return SHIELD_VARIANTS.standard;
  const key = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT);
  return SHIELD_VARIANTS[key] ?? SHIELD_VARIANTS.standard;
}

/** Where the shield is carried: "hand" (default), "back", or "front". */
export function strapOf(item) {
  if (!overlayEnabled()) return "hand";
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.STRAP) ?? "hand";
}

/** True when the shield occupies a hand (and so can form Weapon & Shield). */
export function occupiesHand(item) {
  return strapOf(item) === "hand";
}

/**
 * Does this shield raise ORDINARY armour class right now?
 * @param {boolean} hasShieldSpec Fighting Style Specialization (Weapon & Shield)
 */
export function grantsOrdinaryAC(item, hasShieldSpec) {
  const v = variantOf(item);
  if (strapOf(item) !== "hand") {
    // A front-strapped crescent still covers the front; a back-strapped shield
    // only protects the rear, which is situational rather than ordinary AC.
    return strapOf(item) === "front" && !!v.frontAC;
  }
  if (v.specOnly) return !!hasShieldSpec; // buckler
  return !!v.handAC;
}

/**
 * Correction for `system.aac.mod` that reconciles core's unconditional shield
 * bonus with RAW. Core adds the LAST equipped shield's aac.value; if RAW says
 * that shield grants nothing ordinary, cancel it.
 * @returns {number} 0 or a negative correction
 */
export function shieldACCorrection(loadout, hasShieldSpec) {
  if (!overlayEnabled()) return 0;
  const shields = loadout?.shields ?? [];
  if (!shields.length) return 0;
  const counted = shields[shields.length - 1]; // matches core's last-wins pick
  if (grantsOrdinaryAC(counted, hasShieldSpec)) return 0;
  return -Number(counted.system?.aac?.value ?? 0);
}

/** Is Weapon & Shield Specialization applicable to this loadout's shield? */
export function specApplies(loadout) {
  if (!overlayEnabled()) return true;
  const shield = loadout?.shield;
  if (!shield) return true;
  const v = variantOf(shield);
  return strapOf(shield) === "hand" && v.spec !== false;
}

/** Does the loadout's shield count for the Defend action (phalanx)? RR p. 294. */
export function countsForDefend(loadout) {
  const shield = loadout?.shield;
  if (!shield) return false;
  if (!overlayEnabled()) return true;
  const v = variantOf(shield);
  return v.defendCounts === true || v.key === "standard" || v === SHIELD_VARIANTS.standard;
}

void STYLE;
