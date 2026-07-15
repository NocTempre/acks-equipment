/* global game, Hooks */
/**
 * Paper Doll integration (Phase 4). When fvtt-paper-doll-ui is active and the
 * strategy allows it: set EQUIPPED_PATH="equipped", push an ACKS slot config,
 * and listen to paper-doll-equip / paper-doll-swap to normalise the `slots`
 * flag into the Loadout (with main/off-hand distinction). Otherwise the
 * max-per-type fallback on the core inventory toggle (enforce.mjs) applies.
 *
 * Phase 1 stub: detects presence and logs the chosen strategy; no wiring yet.
 */
import { MODULE_ID, SETTINGS, PAPERDOLL_ID } from "./constants.mjs";

/** Which equip source is authoritative: "paperdoll" or "fallback". */
export function activeStrategy() {
  const pref = game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_STRATEGY);
  const present = game.modules.get(PAPERDOLL_ID)?.active;
  if (pref === "fallback") return "fallback";
  if (pref === "paperdoll") return present ? "paperdoll" : "fallback";
  return present ? "paperdoll" : "fallback"; // auto
}

export function registerPaperDoll() {
  const strategy = activeStrategy();
  console.debug(`${MODULE_ID} | equip strategy: ${strategy} (paper-doll wiring lands in Phase 4).`);
  // Phase 4 will, when strategy === "paperdoll":
  //   - set the paper-doll EQUIPPED_PATH to "equipped"
  //   - push an ACKS globalConfig slot layout (idempotent)
  //   - Hooks.on(PAPERDOLL_HOOKS.EQUIP/SWAP, ...) → normalise slots → refreshLoadout
  void Hooks; // referenced in Phase 4
}
