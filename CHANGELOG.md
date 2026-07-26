# Changelog

Releases up to and including 0.15.1 predate this file; see the git history
and GitHub releases for earlier changes.

## 0.28.0

- **Item properties now live on the item's OWN sheet.** A new **ACKS Properties**
  panel on every weapon/armour/item sheet gathers masterwork, condition
  (scavenged), material, shield variant, helmet type, spell book, and the GM
  apparent-identity mask in one place — so opening an item shows its toggles,
  instead of them only appearing on the character-sheet inventory rows. The
  inventory rows keep their "how you're using it" controls (grip, draw/sheathe,
  light, strap).
- **Material control.** Set any item's material (for the item-loss table) from a
  picker; "Auto" falls back to the name/type guess. It had no UI before.
- **Enclosing helm (RR p140).** New overlay: a heavy (enclosing) helmet imposes
  −1 to surprise (folded into the loadout effect) and −4 to Listening (surfaced);
  +2 on Mortal Wounds is core's own, applied to helmets named with "heavy" and
  "helmet". A light/heavy toggle marks any helmet enclosing.
- **Spell books (RR p145/p390).** Turn any item into a spell book: 100 pages, a
  spell fills one page per level, ½-stone weight; value = 20gp + 1,000gp × each
  scribed spell's level. A free-text manager edits the recorded spells and the
  readout shows pages used and worth. The spell list rides the item, so a looted
  book carries its formulae without appearing in anyone's repertoire.
- **Apparent value / disguise (GM).** Give a magic item a mundane apparent
  identity — players see the fake name/value/stats with no indicator, while the
  real weight stays for encumbrance and the truth waits under a flag until you
  Reveal. Sheet-level secrecy (not encryption): for genuinely secret loot, keep
  the real item on a GM actor until it changes hands.

## 0.27.0

- **Apply RAW qualities to ANY valid item — no pre-made variants needed.** Audit
  of equipment properties that were modeled but had no way to apply them:
  - **Scavenged equipment (RR p160)** was fully modeled (condition tables, −5
    caps, 19–20 rerolls) but had no trigger. A new **Scavenge** control on every
    weapon/armour row rolls the right table onto the item and stamps the result
    on its own fields (−damage → a "1d6-1" string, −attack → bonus, −AC, +stone),
    reversibly, and posts a chat card. Re-rolling starts from pristine so
    conditions never compound; Clear restores the item.
  - **Shield variants (JJ p407)** could only be gotten from the sample pack. A new
    **variant** control on every shield row makes *any* shield a buckler, kite,
    phalanx, etc. — AC/encumbrance/strap rules follow the choice.
  - Both are gated on their optional-rule overlay settings and exposed on the API
    (`scavengeItem`, `clearScavenged`, `setShieldVariant`).
  - Not folded in (flagged for later): the **enclosing-helm** rules (RR p128) have
    no mechanics yet — a missing feature, not a missing control.

## 0.26.0

- **Torch: carry a stack, ready one to wield.** A torch now imports as a carried
  STACK (a bundle you keep in a pack), not a wielded weapon. A new **Ready** control
  on the stack pulls one out as a single 1d4 light-weapon you can wield, light, or
  throw — decrementing the bundle (and clearing it when the last is drawn). Core
  weapons have no quantity, so this is how a *supply* of torches and a *wielded*
  torch coexist. (User: "torches can just carry a stack ... a prepare button.")
- **Per-attack melee/thrown choice.** Thrown melee weapons (hand axe, dagger,
  javelin, spear, warhammer) now import as BOTH melee and missile, so the system's
  own range selector offers "swing or throw" per attack. The Annotate macro
  reconciles existing core weapons the same way. Thrown weapons also add **Strength
  to damage** when hurled (RR p298) — which the system's missile path omits —
  excluding splash flasks (oil, holy water), exactly as RAW carves them out.
- **Unarmed strike.** An empty-handed character now shows an **Unarmed Strike** in
  the Worn & Wielded section (1d3 nonlethal, RR p299) — a mode, not the absence of
  one — that rolls through the system's normal attack pipeline.
- **Draw / sheathe controls.** Every weapon row gains a one-click Draw (carried) or
  Sheathe (wielded) control, alongside grip.
- **Masterwork picker (RR p159).** Weapon and armour rows gain a Masterwork control
  that stamps the chosen tier onto the item's own core fields — +1 hit
  (`system.bonus`), +1 damage (a "1d6 + 1" string), +1 AC (`aac.value`), −1 stone
  (`weight6`) — reversibly. Masterwork stays DATA, not a roll-time overlay, by
  design; this is just the convenient way to write it.
- **Per-shield strap toggle (JJ p407).** Under the shield-variant overlay, each
  shield row gains an in-hand / back / front control. A strapped shield costs no
  hand, so this is how a hand is freed for a torch while the shield still rides.
- Single-shield violation text corrected to the RR p141 rule (one shield benefits).

## 0.25.0

- **Equipment root — `equipmentClass(name)`.** acks-equipment is now the family's
  single "equipment root": given a name it says which core item type a piece of
  gear should become and the stats that type needs (a torch is a 1d4
  light-weapon; military oil and holy water are thrown splash flasks; a lantern
  or candle is a light-bearing item). acks-content consumes this instead of
  re-encoding the rules, so the mechanics live in exactly one place.
- **Torch as an equippable weapon (RR p148/298).** A torch wielded or thrown
  deals 1d4 and gains NO damage bonus from high STR, class, Backstabbing, or the
  like — folded into the attack as a cancelling term so only the *positive* bonus
  is stripped (a penalty still applies).
- **Thrown/splash consumption.** Firing/throwing now consumes correctly for every
  thrown item, not just melee-and-thrown ones: a single splash flask (military
  oil, holy water) SHATTERS (spent, not recoverable); a reusable thrown weapon
  (hand axe, bola) is marked recoverable; a stack decrements. Holy water grounded
  to 1d8 (RR p268/297) and military oil marked no-damage-bonus (RR p298).
- **Single-shield rule (RR p141).** Only one shield ever benefits — an in-hand
  shield plus a back-strapped one is still two shields and is now flagged
  (previously two passed silently). A strapped shield costs no hand, so a shield
  and a held light legitimately coexist.
- **`consumeItem(item, n)`** exported — the shared decrement primitive
  acks-formation reuses to burn torches/oil through the same code path as ammo.

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

