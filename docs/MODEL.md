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
| Item flag (weapon/shield) | `flags.acks-equipment.hand` | `main` \| `off` — set from the Paper Doll slot the item occupies (`MAIN_RIGHT`/`MAIN_LEFT`); resolves dual-wield off-hand identity. |
| Foreign setting (written once) | `fvtt-paper-doll-ui.globalConfig` | Our ACKS slot layout + `EQUIPPED_PATH: "equipped"`, merged over Paper Doll's CONSTS. Pushed once, guarded by our `paperdollConfigured` setting, so GM slot edits are never clobbered. Paper Doll is premium/signed — integrate via its settings + `paper-doll-equip`/`paper-doll-swap` hooks only, never a fork. |

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

Hooks fired — prefixed with the camelCase namespace `acksEquipment` per
acks-module-template `docs/TOOLCHAIN.md` §5b (shared registries carry the module
key): `acksEquipment.loadoutChanged (actor, loadout)`,
`acksEquipment.equipBlocked (actor, item, {reason, resolution})`,
`acksEquipment.purchased (actor, item, cost)`, and
`acksEquipment.preRollAttack (actor, item, mods, ctx)` — our own pre-roll hook,
and the shape proposed for a future core `acks.preRollAttack`.

Pack document `_id`s carry the short key `acksEq`, declared in `module.json` at
`flags.acks-equipment.idPrefix` (validator enforces it once declared).

## 5. Boundaries with sibling modules (in force)

- **acks-formation** owns encumbrance→speed, light/ration consumption. This
  module never writes `system.movement.*` and never re-implements encumbrance;
  it wraps `computeEncumbrance` (see §1) only to apply the RAW rules core's flat
  sum gets wrong, so formation keeps reading one consistent core value.
- **acks-henchmen** owns coin math. The purchase-from-market macro (not yet
  built) reuses `game.modules.get("acks-henchmen").api.adapter.spendGold/grantGold`
  rather than re-implementing denomination handling.
- **acks-monsters** owns gear storage and the `DAMAGE_TYPES`/`NATURAL_WEAPONS`
  enums, read raw/soft so it stays optional. The classifier's `damageType`
  aligns to them.
- **Surprise** determination + the `surprised` status are core's; this module
  only reads them (first-round interrupt helpers).

## 6. Shared library (idea, not built)

`build-packs.mjs`, the Active-Effect modifier collector, the DOM-injection
idiom, and the `DAMAGE_TYPES` enum are duplicated across acks-* modules and are
candidates for extraction. This module vendors its copies; extraction is a
separate cross-module task, not a prerequisite for anything here.

> **Not in effect — future planning.** The template repo carries a *proposal*
> (`docs/FAMILY.md`, `docs/REFACTOR_PLAN.md`) for a strict family hierarchy in
> which a new required `acks-lib` becomes the only permitted inter-module edge
> and the boundaries in §5 are re-mediated through it. **It is a proposal only:
> `docs/TOOLCHAIN.md` remains the only canon in force, and no phase of it runs
> without the maintainer's explicit go-ahead.** Nothing in this module should be
> restructured against it, and §5 above stays authoritative until a phase
> actually lands.
