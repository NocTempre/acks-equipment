/* global libWrapper, game */
/**
 * Combat-roll integration (Phase 3). libWrapper WRAPPER on AcksActor#rollAttack
 * and AcksItem#rollWeapon injects per-attack RAW modifiers (Weapon Finesse,
 * dual-wield off-hand, 2H damage upsize, Weapon Focus, Precise Shooting,
 * non-proficiency −1, impact-on-charge). Documented handoff: propose a core
 * `acks.preRollAttack(actor, item, parts, ctx)` hook to retire this wrap.
 *
 * Phase 1 stub: registers nothing yet; module.mjs guards on the roll-automation
 * setting and this function is a safe no-op until Phase 3 lands.
 */
import { MODULE_ID } from "./constants.mjs";

export function registerRollWrap() {
  // Intentionally empty until Phase 3. Left as the single wiring point so
  // module.mjs need not change when the wrap is implemented.
  console.debug(`${MODULE_ID} | roll wrapper not yet active (Phase 3).`);
}
