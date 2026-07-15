# ACKS II — Equipment & Fighting Styles (`acks-equipment`)

Exhaustive, Rules-As-Written equipment automation for the [ACKS II Foundry
system](https://github.com/AutarchLLC/foundryvtt-acks-core). It fills the gap the
core system leaves open: `equipped` is a bare toggle with no limits. This module
enforces the RAW.

> Design priority: **reuse → extend → enhance → replace**. The core system is
> never edited; this module reads core data and writes only its own flags plus
> one managed Active Effect that targets fields core already sums. See
> [`docs/MODEL.md`](docs/MODEL.md) for the contract and [`docs/RULES.md`](docs/RULES.md)
> for the rules it implements.

## Features

- **Equippable-limit enforcement** — hand budget (weapons + shields), one worn
  suit of armour, ≤2 shields, shield needs a free hand. Default *warn +
  auto-resolve*; configurable to hard-block or advisory.
- **Fighting styles** — infers Single / Dual / Two-Handed / Weapon & Shield /
  Missile from the loadout; applies Fighting Style Specialization bonuses via the
  loadout Active Effect (AC, initiative, attack, damage) into core's `system.*.mod`.
- **Proficiency & skill integration** — weapon/armour/fighting-style proficiency
  and thief-skill armour gates, driven by effect flags on `ability` items. Ships
  42 combat/equipment proficiencies (Fighting Style Specialization, Weapon Finesse,
  Weapon Focus, Martial/Armour Training, Combat Trickery, slayers, and more) plus
  a Configure-Proficiencies macro.
- **Combat-roll automation** — per-weapon RAW modifiers injected into core's
  attack/damage rolls via libWrapper: the non-proficiency −1 (weapon *or*
  untrained style, applied once), Weapon Finesse (DEX for STR), and the
  two-handed damage upsize. Loadout-level bonuses (style Specialization,
  dual-wield +1, Combat Reflexes, Swashbuckling) need no patch — they ride
  core's own `system.*.mod` fields via the loadout effect.
- **Draw / sheathe** — a macro applying the RAW action economy, free with
  Fighting Style Specialization.
- **Paper Doll integration** *(Phase 4)* — theripper93's `fvtt-paper-doll-ui`
  slots with main/off-hand distinction, and a max-per-type fallback without it.
- **Optional RAW overlays** *(Phase 5)* — shield variants, masterwork, maneuvers,
  item loss, mounted saves, named items, scavenged, beastman gear — each a toggle.

## Requirements

- Foundry VTT v14, system `acks` v14+.
- **Required:** [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper),
  [socketlib](https://github.com/manuelVo/foundryvtt-socketlib).
- **Optional:** [Paper Doll](https://theripper93.com) (`fvtt-paper-doll-ui`).

## Development

```bash
npm install
npm run validate     # check pack sources
npm run build:packs  # compile compendia to LevelDB
```

Status: **Phases 1–3 complete** (loadout model, equip-limit enforcement, loadout
effect, proficiency/skill enforcement, 42-item proficiencies compendium,
libWrapper roll integration, 4 support macros). Phase 4 (Paper Doll) and Phase 5
(RAW overlays + sample equipment) in progress.
