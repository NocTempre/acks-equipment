# ACKS II — Equipment & Fighting Styles (`acks-equipment`)

Exhaustive, Rules-As-Written equipment automation for the [ACKS II Foundry
system](https://github.com/AutarchLLC/foundryvtt-acks-core). It fills the gap the
core system leaves open: `equipped` is a bare toggle with no limits. This module
enforces the RAW.

> Design priority: **reuse → extend → enhance → replace**. The core system is
> never edited; this module reads core data and writes only its own flags plus
> one managed Active Effect that targets fields core already sums. See
> [`docs/MODEL.md`](docs/MODEL.md) for the contract and the local rules extract (`acks-rules/acks-equipment/RULES.md`)
> for the rules it implements.

## Features

- **Equippable-limit enforcement** — hand budget (weapons + shields), one worn
  suit of armour, ≤2 shields, shield needs a free hand. Default *warn +
  auto-resolve*; configurable to hard-block or advisory.
- **Fighting styles** — infers Single / Dual / Two-Handed / Weapon & Shield /
  Missile from the loadout; applies Fighting Style Specialization bonuses via the
  loadout Active Effect (AC, initiative, attack, damage) into core's `system.*.mod`.
- **ACKS Abilities bridge** — characters built with the acks-abilities /
  acks-content model (generic ability items with recorded picks) feed the same
  automation: Weapon Finesse, a Specialization's style, Martial Training's
  weapon group, Armour Training ranks, Weapon Focus, and Combat Trickery
  maneuvers all resolve from that model. Deliberately asymmetric: bridged
  facts grant bonuses and training, but Non-Proficient Use penalties stay off
  under the Automatic setting, because the abilities model cannot yet express
  class training lists and absence must not read as untrained.
- **Proficiency & skill integration** — weapon/armour/fighting-style proficiency
  and thief-skill armour gates, driven by effect flags on `ability` items. Ships
  42 combat/equipment proficiencies (Fighting Style Specialization, Weapon Finesse,
  Weapon Focus, Martial/Armour Training, Combat Trickery, slayers, and more) plus
  a Configure-Proficiencies macro.
- **Combat-roll automation** — per-weapon RAW modifiers injected into core's
  attack/damage rolls via libWrapper: the full Non-Proficient Use package
  (weapon and fighting-style proficiency are distinct and BOTH required —
  1st+ level characters attack as 0th-level fighters while equipped with
  anything unusable by their class, 0th-level characters take an additional
  −1, and no attribute bonus applies to attack throws or AC; class powers and
  XP denial are surfaced as a Judge-facing warning), Weapon Finesse (DEX for
  STR), and the two-handed damage upsize. Loadout-level bonuses (style Specialization,
  dual-wield +1, Combat Reflexes, Swashbuckling) need no patch — they ride
  core's own `system.*.mod` fields via the loadout effect.
- **Wear locations on the character sheet** — the Inventory tab regroups worn
  gear by where it actually sits (Head, Body, Worn, Main Hand, Off Hand, Both
  Hands, Strapped), plus a bucket per container, instead of core's flat
  group-by-item-type. Core's own rows are *moved*, not rebuilt, so every control
  on them keeps working. No Paper Doll required.
- **Containers** — nested inventory with the RAW weight roll-up (RR pp. 142–145,
  161). Contents stay real items on the actor, so core's encumbrance counts each
  exactly once; only the two rules a flat sum gets wrong are corrected (the
  adventurer's harness ignoring a stone, the bowquiver counting as two items).
  The Container Manager flags carrying gear from the RAW capacity table, turns
  any item into a container, and moves gear in and out by drag-and-drop.
- **Draw / sheathe** — a macro applying the RAW action economy, free with
  Fighting Style Specialization.
- **Paper Doll integration** — when theripper93's `fvtt-paper-doll-ui` is
  installed, ACKS slots (hands, armour, helmet) are pushed to it once and
  drag-and-drop writes `system.equipped`, so the doll feeds the *same* RAW
  enforcement. Without it, the max-per-type fallback on the core inventory
  applies. Either way the rules are identical.
- **Optional RAW overlays** *(Phase 5)* — shield variants, combat maneuvers,
  item loss, named magic items, scavenged equipment — each a toggle. Mounted
  saves, beastman gear, and the enclosing helmet are **not** implemented; their
  toggles are deliberately not registered rather than shown doing nothing.

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

## Compendiums

| Pack | Contents |
| --- | --- |
| **Equipment & Combat Proficiencies** | 42 effect-carrying `ability` items — Fighting Style Specialization ×5, Weapon Focus ×6, Martial Training ×7, Combat Trickery ×7, Weapon Finesse, Precise Shooting, Armour Training, slayers, and more. Drag onto a character and the automation follows. |
| **Equipment Samples** | Content core doesn't ship: the six JJ shield variants, masterwork exemplars, and a named magic weapon. Ordinary RAW gear stays in core's `acks-all-equipment` — the *Annotate Equipment* macro upgrades those in place. |
| **Sample Characters** | Four pre-wired demo characters (sword & board, two-handed, dual-wield thief, restricted mage), each demonstrating one rule end-to-end. |
| **Equipment Macros** | Loadout Inspector, Annotate Equipment, Configure Proficiencies, Draw / Sheathe, Containers, and the overlay helpers. |

Status: **Phases 1–5a complete** (loadout model, equip-limit enforcement, loadout
effect, proficiency/skill enforcement, libWrapper roll integration, character-sheet
wear buckets, containers, Paper Doll integration + fallback, and all four
compendiums). Phase 5b (RAW optional-rule overlays) in progress — three overlays
remain unimplemented, listed above. A full RAW equipment import, market/purchasing,
and mounted combat are separate efforts.

## License

**Code:** © NocTempre — proprietary; all rights reserved except as granted to
Autarch LLC under the **ACKS II App License**. This module is **not** open source
or Open Game Content, and no license is granted to copy, redistribute, or reuse
its code. See [`LICENSE`](LICENSE).

**ACKS II content** is used under the **ACKS II App License**. ACKS, ACKS II, and
Adventurer Conqueror King System are trademarks of **Autarch LLC**.

**Unofficial** — this is an unofficial fan module, not published or endorsed by
Autarch LLC.

**Registration #:** _[pending registration]_

**Requires:** a legitimate copy of the ACKS II rules this module draws on —
Adventurer Conqueror King System II (ACKS II), equipment & combat-proficiency rules
_[confirm exact publication title(s)]_. The module is not a substitute for the
books and is free to use.
