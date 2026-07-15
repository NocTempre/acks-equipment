/* global game */
import { MODULE_ID, SETTINGS, ENFORCE } from "./constants.mjs";

const L = (k) => `ACKS-EQUIPMENT.settings.${k}`;

/** Register all world/client settings. Called at init. */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.ENFORCE_MODE, {
    name: L("enforceMode.name"),
    hint: L("enforceMode.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [ENFORCE.RESOLVE]: L("enforceMode.resolve"),
      [ENFORCE.VETO]: L("enforceMode.veto"),
      [ENFORCE.ADVISORY]: L("enforceMode.advisory"),
    },
    default: ENFORCE.RESOLVE,
  });

  game.settings.register(MODULE_ID, SETTINGS.ROLL_AUTOMATION, {
    name: L("rollAutomation.name"),
    hint: L("rollAutomation.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.PAPERDOLL_STRATEGY, {
    name: L("paperdollStrategy.name"),
    hint: L("paperdollStrategy.hint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: L("paperdollStrategy.auto"),
      paperdoll: L("paperdollStrategy.paperdoll"),
      fallback: L("paperdollStrategy.fallback"),
    },
    default: "auto",
  });

  game.settings.register(MODULE_ID, SETTINGS.DEFAULT_HAND_BUDGET, {
    name: L("defaultHandBudget.name"),
    hint: L("defaultHandBudget.hint"),
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    range: { min: 1, max: 8, step: 1 },
  });

  // Optional-rule overlays (RAW). Off by default except standard shields which
  // are already core; each toggle is world-scoped.
  const overlay = (key, def = false) =>
    game.settings.register(MODULE_ID, key, {
      name: L(`${key}.name`),
      hint: L(`${key}.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: def,
    });

  overlay(SETTINGS.OVERLAY_SHIELD_VARIANTS);
  overlay(SETTINGS.OVERLAY_MASTERWORK, true);
  overlay(SETTINGS.OVERLAY_MANEUVERS, true);
  overlay(SETTINGS.OVERLAY_ITEM_LOSS);
  overlay(SETTINGS.OVERLAY_MOUNTED, true);
  overlay(SETTINGS.OVERLAY_NAMED);
  overlay(SETTINGS.OVERLAY_SCAVENGED);
  overlay(SETTINGS.OVERLAY_BEASTMAN);
  overlay(SETTINGS.OVERLAY_ENCLOSING_HELM, true);
}

/** Convenience getter. */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
