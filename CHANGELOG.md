# Changelog

## 0.35.0

- **Uninstall — Strip Equipment Data** (macro + `api.stripModuleData`):
  deletes the managed loadout effects (which would otherwise keep applying
  stale modifiers forever once the module is off), reveals disguised items,
  optionally reverts masterwork/scavenged layers to pristine, and removes
  every module flag from actors, items, and unlinked token actors.
- **The Paper Doll follows its sheet out.** Closing a character sheet closes
  that actor's doll window (3.x on v14 left it orphaned).
- **README: GM getting-started** (annotate → proficiencies → equip) and a
  **Disabling & uninstalling** section — including the dependency-dialog trap
  where Foundry pre-checks acks-lib for deactivation, making Animal/Group/
  Template actors unavailable until it is re-enabled (no data is lost).

Releases up to and including 0.15.1 predate this file; see the git history
and GitHub releases for earlier changes.

## 0.34.0

- **Re-naming works from the sheet, and never depends on the overlay setting.**
  The JJ p399 re-naming path — a finder gives the item a new name, unlocking its
  first power — had no sheet control, and the macro that carried it refused to
  run with the named-item overlay off, which made renaming impossible. The named
  strip now has a **Re-name** field and button (owner or GM); the overlay setting
  gates only the level-up automation, as it should.
- **A disguise hides named status from players.** The signature badge on a
  disguised item told every player it was something special. Players now see no
  named badge (or tracker) while an apparent identity is active; the GM sees
  both. The visibility rule is a single tested function.
- **Macro doctrine: macros are for scripts, not for driving game features.** The
  *Named Arms & Armour* and *Draw/Sheathe* macros are retired — the item sheet's
  header tracker and the inventory rows' draw/sheathe controls are the primary
  interface. Script-like macros stay (Annotate Equipment, Containers annotate,
  Loadout Inspector report, Item Loss resolver, Recover Thrown, Configure
  Proficiencies — the latter three are flagged to move into proper sheet UI in a
  later pass).

## 0.33.0

**The named-item tracker is now findable and is an actual tracker.**

- **A named item always shows its signature badge** — the tracker was hidden
  behind the "Overlay: named magic items" setting (default off), so a named item
  showed nothing at all. The record lives on the item; its state is now always
  visible. The setting still governs the *automation* (advancement on level-up)
  and whether a GM is offered the badge on ordinary, unnamed gear — and the
  strip tells the GM when that automation is off.
- **The strip shows the unlock ladder as rungs**: one pip per point of the
  item's power in the Judge's order, lit when unlocked, with each rung's
  category on hover, the unlocked-bonus line, and the revealed state.
- **Legacy records display properly.** An early record carrying only
  `unlocked/max` (no ladder yet) used to read as an empty 0/0; it now shows its
  real progress with unlabelled rungs, and warns the Judge that no unlock order
  is set — without one, no bonuses can apply (JJ p399: the Judge chooses the
  order).
- The sample **Tooth-Breaker** now ships as the Judges Journal worked example:
  the six-rung damage/hit ladder with one rung unlocked (+1 damage), its base
  stats captured, and its fields reflecting the unlocked rung.

## 0.32.1

Hotfix for 0.32.0's sheet — it could render as a header over an empty body:

- **The tab panes were being crushed to zero height.** The header overlay-strip
  container carried `flex-basis: 100%`, and in the window's column layout that
  means 100% of the HEIGHT — an invisible block that swallowed the body, leaving
  the nav and every pane squeezed out of view. It now takes only the height of
  an open strip (zero when closed).
- **Overlay strips no longer accumulate.** The sheet re-renders on every field
  change; the strips container sat between parts and survived, so each render
  injected a fresh copy beside the orphan — a stale strip could sit permanently
  open. Overlays now rebuild idempotently, and the strip you had open stays open
  across re-renders (applying a disguise no longer snaps it shut).
- **Defensive registration.** On a system build whose item sheet lacks the parts
  this subclass leans on, the module keeps the system sheet instead of
  registering a broken one, and each sheet decoration is guarded separately so
  one failure cannot blank the rest.

## 0.32.0

**The equipment item sheet, restructured.** Weapon, armour and item documents now
open in the module's own sheet — a subclass of the system's item sheet (the same
technique the ACKS Abilities sheet uses; core is untouched, and the plain system
sheet remains selectable per item via sheet configuration):

- **Description** is prose only.
- **Rolls** is its own tab: core's stats side-column (damage, bonus,
  melee/missile, range, save — or AC and armour type, or subtype and quantity)
  moves there whole, as core's own nodes, so every core input and button keeps
  working exactly as before.
- **Construction** is its own tab: masterwork, condition (with the Roll button),
  material, shield variant, helmet type, and the net-effect line.
- **Spells** appears ONLY on a recognised Spell Book — a specific item class,
  never a property of ordinary gear — holding its formula list, page count and
  value.
- **Named item and Apparent identity are header overlays now**, not panel rows:
  badges beside the item's name (a signature for the JJ named-item state, a mask
  for the GM's disguise) that unfold an overlay strip. The named strip shows the
  given name, unlocked powers and bonuses, lets a wielder speak a name (the
  once-per-level guess, JJ p399), and lets the Judge set the true name, the
  unlock ladder and the unlocked count; un-naming restores the captured base.
  The disguise strip carries the apparent name/value/stat fields with
  Apply / Reveal and always states whether a disguise is on.

## 0.31.0

- **Fix: item properties did not save at all.** The panel's dropdowns and fields
  sit inside core's sheet form, and an ApplicationV2 sheet submits on change — so
  every selection bubbled to core's handler, which re-rendered the sheet from its
  own form data and discarded the write in flight. Picking a masterwork tier, a
  condition or a material looked like it did nothing, because nothing persisted.
  Their change events are now stopped before they reach the form.
- **Gold value follows the properties.** Masterwork adds its RR p159 surcharge
  (+80gp / +650gp) and a scavenged condition applies its resale percentage, both
  recomputed from the item's pristine price — so 50gp armour made masterwork is
  700gp, and 469gp once it also has broken straps. Clearing the layers restores
  the original price exactly.
- **The panel says what each property did.** A **Net effect** line spells out the
  combined result — "+1 AC, 700gp (was 50gp)" — including a scavenged condition's
  break / cannot-sneak / initiative notes and any effect text the vessel table
  carries. **Material** now explains that it decides which damage types can
  destroy the item (JJ p398) rather than granting a modifier.
- **Disguise state is always visible.** The row reads either "Not disguised" or
  names the true item hiding underneath, and offers Update / Reveal. A GM
  previously had no way to tell a disguise was on — the item is supposed to look
  mundane everywhere else.

## 0.30.0

- **The condition control now reads YOUR book's table.** acks-content 0.56.0
  extracts RR p160's four scavenged grids into the ruledata registry; when that
  import is present, both the **Roll** button and the condition **dropdown** use
  it — your bands, your category names, your effects, your resale percentages —
  and the effect text is parsed into the mechanics it applies (−1 damage, −1 to
  attacks, +1 stone, cannot sneak, −1 AC, breaks). An effect phrase outside that
  vocabulary (the vessel table's cargo/speed/hull entries) is preserved verbatim
  as a note for the Judge rather than dropped. The built-in RAW table remains the
  fallback for a world that has not imported one.
- The roll goes through Foundry's own dice roller now, so the roll log and
  dice-so-nice see it; 19–20 re-rolls are honoured against whichever table is in
  play. The old world-RollTable lookup is gone — the ruledata registry is the one
  source.

## 0.29.0

- **Item properties are inline controls now — dropdowns, fields and buttons, not
  pop-up dialogs.** Masterwork, condition, material, shield variant and helmet
  type are **dropdowns** you change in place; the spell list is an editable
  **text area**; the GM's apparent identity is a row of **entry fields** with
  Apply / Reveal. Nothing opens a dialog any more. The duplicate masterwork /
  condition / variant controls are gone from the character-sheet inventory rows —
  those describe what an item *is*, so they live on the item sheet; the rows keep
  grip, draw/sheathe, light and strap (how you are *using* it).
- **Fix: properties did not fully apply or clear.** Masterwork and a scavenged
  condition each stamped the same core fields *and each kept its own snapshot* of
  "before" — so applying both and clearing either restored a baseline that still
  contained the other's delta, leaving residue (a "Pristine" item still reading
  1d6-1) or silently dropping the surviving layer. There is now **one** pristine
  baseline per item and every change **recomputes** all layers from it. Damage
  modifiers combine numerically: a +1 masterwork and a −1 dent read `1d6`, not
  `1d6 + 1-1`. Clearing the last layer restores the item exactly and drops the
  baseline.
- **The condition roll uses your imported table when you have one.** If a
  scavenged-condition RollTable has been imported from your own book (matched by
  its ruledata key, or by name), the roller **draws from that table** — its
  formula, its rows, its chat card — and maps the result back to the mechanical
  effect. The built-in RAW table is only the fallback for a world that has not
  imported one, so the control always works. 19–20 re-rolls are honoured either
  way, and the condition can also just be **picked** from the dropdown.

## 0.28.1

- **A spell book is a recognised item, not a toggle.** Dropped the "make any item
  a spell book" control from 0.28.0 — a spell book is now the recognised RR "Spell
  Book" item (matched by name, or by an already-stored spell list so a renamed
  book keeps its identity), and only such an item shows the page/value/spell-list
  manager. Ordinary gear no longer offers to become one.

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

