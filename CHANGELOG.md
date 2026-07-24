# Changelog

Releases up to and including 0.15.1 predate this file; see the git history
and GitHub releases for earlier changes.

## 0.20.0

- **Proficiency enforcement is ON by default.** The `Proficiency penalties`
  setting now defaults to `on` (was `auto`), so the RR p.106 Non-Proficient Use
  package applies out of the box: equipping a weapon or armour beyond a
  character's declared proficiency — or wielding a weapon with no trained
  fighting style — attacks as a 0th-level fighter with no attribute bonus to
  attack or AC. Configure each character with its **ACKS Class Training** items
  (a fighting style plus the weapon/armour proficiency lists); those lists are
  the source of truth, not content import. Weapon and armour lists stay
  permissive when unset (an un-configured list never reads as non-proficient),
  but a trained fighting style is required to use any weapon at all (RR p.106),
  so a weapon-wielder needs a Class-Training style item. acks-abilities' positive
  grants still bridge through regardless of the setting. Set the setting to
  `auto` (the previous default — penalties off while ACKS Abilities is active)
  or `off` if characters rely on acks-abilities for their base proficiency lists.

## 0.19.1

- `locks.mjs` now imports `slug` from acks-lib instead of its own copy. Pure
  refactor (identical output). `config.mjs`'s `normalizeName` stays local — that
  file is deliberately Foundry-free and node-importable, not worth coupling to
  acks-lib for a one-liner.

## 0.19.0

**Weight computation consumes acks-lib's `itemModel.weight6Of`.** The local
`itemWeight6` was a duplicate of the family's weight primitive; it's gone, and
the container roll-up, harness relief, and bowquiver correction now call
`weight6Of` from acks-lib. `acks-lib` is a new hard `requires` — the RAW
encumbrance total must always compute, so this can't be an optional binding.
Verified live: a container's load rolls up identically (rations ×7 + weapon +
weightless coins), and 303 offline checks pass.

Deliberately NOT migrated (each would be corrupted by `weight6Of`'s
quantity-multiplication): the harness per-unit "heavy" check, `item-loss`'s
per-unit risk weight, and the shield encumbrance baseline all still read raw
`system.weight6`. `STOWABLE_TYPES` stays too — it is `isPhysical ∪ {money}`
(money is stowable but not physical), not the same set as `isPhysical`.

## 0.18.0

**Containers move onto the equipment tab; the popout is retired.**

The Container Manager window existed because there was nowhere else to put its
controls. There is now: a container sits on the character sheet's equipment tab
next to the gear it holds, and opening it there is the same gesture as opening
it at the table.

- **Inline open/collapse.** Every container's contents expand and fold in place.
- **Conceal** is a tidiness toggle: it folds the row and hides nothing from
  anyone. Contents still count for weight and encumbrance.
- **Lock**, and **visibility inherited from ownership while locked.** Picking up
  a locked crate tells you that you are carrying a locked crate — not what is in
  it. Own it and it is open, you see inside; own it and it is locked, you do
  not, until the lock is defeated. The GM always sees inside.
  A locked container also refuses new items: you cannot put the sword in the
  chest without opening the chest.
  The load is NEVER hidden — a locked chest still drags on your encumbrance, and
  concealing its weight would make the number on the sheet unexplainable. This
  is a UI rule, not a security boundary; put genuinely secret contents on a
  GM-owned actor.
- **Lockpicking and Dungeon Bashing** defeat a lock — by rolling the CHARACTER'S
  OWN proficiency. This module ships no throw for either: it has not read one off
  anyone's page, and a fabricated target is worse than no automation. It rolls
  the Lockpicking or Dungeon Bashing item on the sheet, whose target came from
  the reader's book, through acks-abilities' roller. No proficiency, no roller,
  or no throw on the ability → it says so and leaves the roll to the table.
  Enforced RAW: **gloves block lockpicking** (RR p. 145).
  Bashing DESTROYS the container; contents spill, unless it is marked
  `fragile`, in which case they break with it. Confirmed before it happens.
- **Drag-to-stow works on the sheet**, including dragging an item back down to
  core's own lists to take it out.
- **A phalanx shield is now unusable mounted**, as RAW says. The variant table
  has carried `noMount` all along with nothing able to answer "am I mounted?";
  acks-lib 0.10.0 records the mount binding, so the rule fires. Kite shields —
  which are *for* horseback — are unaffected, and with acks-lib absent every
  mounted rule stays dormant. `mountEnc`, `mountAlternates` and `mountShares`
  remain unwired on purpose: shield encumbrance is not implemented at all, and
  the self-or-mount protection choice is a player's decision each round, not a
  derivable fact.

**Declared-but-inert rules, now implemented.** A sweep for config that nothing
reads (`npm run find:dead-config`, added here) found ten authored rules that
looked implemented in the data and did nothing at the table:

- **Shield encumbrance by variant and carry state** (`enc`, `encItem`,
  `frontEnc`, `mountEnc`). Every shield weighed whatever its item said. Now a
  buckler is rated as one *item* rather than one stone, a kite shield rides
  lighter mounted (2 stone → 1), and a front-strapped crescent is *heavier*
  than a slung one (2 against 1) — which is what the table says. Contributed as
  a correction to core's flat sum, alongside the harness and bowquiver, so core
  keeps counting each item exactly once. Only EQUIPPED shields are re-rated: one
  in a pack is cargo.
- **`noBack`** — a kite or phalanx shield cannot be slung on the back at all.
  Corrected in `strapOf()`, the single place everything else asks, so a bad flag
  cannot leak separately into the hand budget, the AC correction and the weight.
- **Melee damage from the effect-domain channel.** Both attack domains had an
  outlet and `STYLE_DAMAGE_MELEE` did not, so anything contributing melee damage
  that way was summed and then silently discarded.
- Removed `ACTOR_FLAGS.LAST_LOADOUT`: a dedupe guard nothing set, for a job
  `syncLoadoutEffect` already does by comparing change hashes.

The six entries that remain unread are now documented **at the entry** with the
reason — `backAC` and `vulnerableProtects` need per-attack context the system
does not model; `mountAlternates` and `mountShares` are a player's choice each
round, not a derivable fact; `MASTERWORK` is deliberately data rather than
automation. `SLAYER` and `NO_SHIELD_BENEFIT` are marked as seams: a slaying
bonus applies against a creature KIND, which acks-lib's `scopeApplies` already
answers, so it belongs in the scoped-modifier path rather than as a flat domain
summed blindly here.

**Breaking:** `api.openContainerManager` is removed along with the window. The
shipped Containers macro now annotates carrying gear and opens the sheet.
New API: `isLocked`, `isConcealed`, `isFragile`, `canSeeInside`, `setLocked`,
`setOpened`, `setConcealed`, `pickLock`, `bashOpen`, `destroyContainer`,
`canPick`, `canBash`.

