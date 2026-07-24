# Changelog

Releases up to and including 0.15.1 predate this file; see the git history
and GitHub releases for earlier changes.

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

**Breaking:** `api.openContainerManager` is removed along with the window. The
shipped Containers macro now annotates carrying gear and opens the sheet.
New API: `isLocked`, `isConcealed`, `isFragile`, `canSeeInside`, `setLocked`,
`setOpened`, `setConcealed`, `pickLock`, `bashOpen`, `destroyContainer`,
`canPick`, `canBash`.

