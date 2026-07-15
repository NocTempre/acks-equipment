# acks-equipment — Data Model & Integration Contract

How this module stores data, the Active-Effect contract it reads, the API it
exposes, and where its responsibilities end. Companion to `docs/RULES.md` (the
RAW source of truth behind the code enums).

## 1. Design rules

- **Core is frozen.** The module never edits the `acks` system source. It reads
  core item/actor data and writes only its own flags plus one managed Active
  Effect that targets real core `system.*.mod` fields.
- **Reuse core fields.** Always-on modifiers are written into the fields core
  already sums (`system.aac.mod`, `system.initiative.mod`,
  `system.thac0.mod.melee/missile`, `system.damage.mod.melee`) so
  `computeAC`/`rollAttack` consume them with no patch. Per-attack modifiers that
  cannot be static are injected by a libWrapper wrap on `rollAttack`/`rollWeapon`
  (Phase 3), documented as a handoff to a proposed core `acks.preRollAttack` hook.
- **Single responder.** Loadout writes (auto-unequip, effect sync) run on exactly
  one client — the active GM if online, else the actor owner — to avoid duplicate
  effects (`enforce.primaryResponder`). Phase 4 upgrades this to socketlib routing.
- **Data-driven, not name-driven.** Proficiency mechanics live as Active-Effect
  changes keyed `flags.acks-equipment.<domain>` on `ability` items, read by the
  collector in `effects.mjs` (mirrors acks-henchmen). Name matching is only a
  last-resort fallback.

## 2. Storage map

| Location | Key | Meaning |
|---|---|---|
| Actor flag | `flags.acks-equipment.styles` | CSV/array of fighting styles the actor is trained in (adds to the mandatory `single,missile`). |
| Actor flag | `flags.acks-equipment.activeStyle` | Player's chosen style when two apply this round (overrides inference). |
| Actor AE | name `Equipment Loadout`, `flags.acks-equipment.loadout = true` | Module-managed effect; `changes[]` target core `system.*.mod`; rebuilt on every loadout change; deleted when empty. |
| Item flag (weapon) | `flags.acks-equipment.{size,hands,style,handy,thrown,damageType}` | Per-item classifier overrides (stamped by the annotate macro). |
| Item flag (armor) | `flags.acks-equipment.{shieldVariant,strap,masterwork,helmet}` | Overlay metadata. |
| Item flag (weapon set by paper-doll) | `flags.acks-equipment.hand` | `main` \| `off` \| `mainOff` — hand assignment (Phase 4). |

## 3. Effect contract — `flags.acks-equipment.<domain>`

Numeric domains sum; CSV domains collect; boolean-ish domains test presence. Add
`flags.acks-equipment.condition` (i18n key/text) to an effect to mark its bonus
**situational** → surfaced as a toggle in the pre-roll dialog (Phase 3).

| Domain | Kind | Consumed for |
|---|---|---|
| `handBudget` | numeric | raises the base 2-hand budget (Four Arms, monster anatomy) |
| `styleProficient` | CSV `style` or `style:spec` | trained styles / Fighting Style Specialization |
| `styleInit` | numeric | flat initiative (Combat Reflexes) |
| `styleAC` `styleAttackMelee` `styleAttackMissile` `styleDamageMelee` | numeric | flat combat mods |
| `maxCleaves` | numeric | Combat Ferocity (roll-time) |
| `weaponFocus` | CSV | Weapon Focus categories (roll-time nat-20 die) |
| `slayer` | CSV `group:bonus` | Goblin-/Vermin-Slaying (roll-time, situational) |
| `martialWeapons` | CSV | weapon categories added to proficiency |
| `armorTraining` | numeric | armour categories added above class |
| `swashbuckling` | boolean | conditional AC (≤ light armour, ≤5 st, by level) → loadout AE |
| `running` | boolean | +30' speed marker — read by movement modules (formation), not written here |
| `finesse` `preciseShooting` `sniping` `ambushing` `skirmishing` `unarmedFighting` `blindFighting` `mountedCombat` `riding` `berserkergang` `freeSwap` | boolean | proficiency presence tests |

Per-actor proficiency profile (not effects): `flags.acks-equipment.styles` (trained
fighting styles), `.weaponProficiency` (`"all"` or CSV of categories/weapon keys),
`.armorMax` (heaviest armour category). Set via the Configure Proficiencies macro.

## 4. Public API & hooks

`game.modules.get("acks-equipment").api` (mirror `globalThis.acksEquipment`):
`getLoadout(actor)`, `handBudget`, `trainedStyles`, `specializedStyles`,
`classifyWeapon`, `handCost`, `focusGroup`, `weaponKey`, `annotateItem(item)`,
`refreshLoadout(actor)`, the effect collectors, `config`, `HOOKS`, `VIOLATION`.

Hooks fired: `acks-equipment.loadoutChanged (actor, loadout)`,
`acks-equipment.equipBlocked (actor, item, {reason, resolution})`,
`acks-equipment.purchased (actor, item, cost)`. `acks-equipment.preRollAttack`
is our own pre-roll hook and the name proposed for a future core hook.

## 5. Boundaries with sibling modules

- **acks-formation** owns encumbrance→speed, light/ration consumption. This
  module never writes `system.movement.*`/`system.encumbrance.*`; it exposes the
  loadout so formation keeps reading equipped weapons/`weight6` as today.
- **acks-henchmen** owns coin math. The purchase macro reuses
  `game.modules.get("acks-henchmen").api.adapter.spendGold/grantGold`.
- **acks-monsters** owns gear storage and the `DAMAGE_TYPES`/`NATURAL_WEAPONS`
  enums, read raw/soft. The classifier's `damageType` aligns to them.
- **Surprise** determination + the `surprised` status are core's; this module
  only reads them (first-round interrupt helpers).

## 6. Proposed shared library (not yet built)

`build-packs.mjs`, the effect collector, the DOM-injection idiom, and the
`DAMAGE_TYPES` enum are duplicated across acks-* modules. Propose an `acks-lib`
(or promote acks-monsters as enum owner). This module vendors copies with a
`// TODO: migrate to acks-lib` marker; migration is a separate cross-module task.
