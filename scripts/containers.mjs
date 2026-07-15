/* global game */
/**
 * Containers — nested inventory with a RAW weight roll-up (RR pp. 142–145, 161;
 * docs/RULES.md §1/§3).
 *
 * Design note (reuse first). Contents stay REAL items on the actor, flagged with
 * `containedIn`. That means core's computeEncumbrance already counts each item
 * exactly once, and a backpack's contents already weigh on the carrier — which
 * is what RAW wants. So the common case needs **no** correction at all, and
 * acks-formation keeps reading core's encumbrance unchanged.
 *
 * Only two RAW rules genuinely disagree with a flat sum, and only those are
 * corrected:
 *
 *  1. **Adventurer's harness** (RR p. 142): the wearer "can ignore 1 stone's
 *     worth of equipment". It cannot secure heavy items, coins, or be worn over
 *     heavy armour — so the stone it forgives is drawn only from ordinary
 *     (non-heavy, non-coin) gear.
 *  2. **Bowquiver** (RR p. 142): empty it counts as 1 item; holding a bow and 20
 *     arrows the whole assembly counts as **2 items** — not bow (1 stone) plus
 *     quiver plus arrows. A flat sum is wildly heavier than RAW.
 *
 * Capacity (backpack 4 st, rucksack 2, sack 6/2, saddlebag 3, pouch 1/2) is
 * enforced as a warning on the container, not by altering weight.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";

/** A stone is six 1/6-stone units — core stores weight in `weight6`. */
export const STONE = 6;

/** Container spec on an item: flags.acks-equipment.container = {capacity}. */
export function containerOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.CONTAINER) ?? null;
}
export function isContainer(item) {
  return !!containerOf(item);
}
/** Declared capacity in stone (0 = unlimited/unspecified). */
export function capacityStone(item) {
  return Number(containerOf(item)?.capacity ?? 0);
}
/** The container item id this item is stored inside, if any. */
export function containedIn(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.CONTAINED_IN) ?? null;
}
/** Items stored directly inside a container. */
export function contentsOf(actor, containerId) {
  return actor.items.filter((i) => containedIn(i) === containerId);
}

/** Effective weight6 of one item, honouring quantity the way core does. */
function itemWeight6(item) {
  const w = Number(item.system?.weight6 ?? 0);
  if (item.type === "item") return w * Number(item.system?.quantity?.value ?? 1);
  return w;
}

/** Total weight6 of a container's contents (one level; nesting recurses). */
export function contentsWeight6(actor, containerId, seen = new Set()) {
  if (seen.has(containerId)) return 0; // guard against a container inside itself
  seen.add(containerId);
  return contentsOf(actor, containerId).reduce(
    (sum, i) => sum + itemWeight6(i) + (isContainer(i) ? contentsWeight6(actor, i.id, seen) : 0),
    0,
  );
}

/** Is a container carrying more than its RAW capacity? */
export function overCapacity(actor, container) {
  const cap = capacityStone(container);
  if (!cap) return false;
  return contentsWeight6(actor, container.id) > cap * STONE;
}

/** Every container on the actor, with its load — for the popout UI. */
export function containerReport(actor) {
  return actor.items
    .filter(isContainer)
    .map((c) => {
      const load6 = contentsWeight6(actor, c.id);
      const cap = capacityStone(c);
      return {
        item: c,
        capacityStone: cap,
        load6,
        loadStone: load6 / STONE,
        over: cap > 0 && load6 > cap * STONE,
        contents: contentsOf(actor, c.id),
      };
    });
}

/**
 * Ordinary gear the harness is able to secure (RR p. 142): not the harness
 * itself (it is the securing device, not secured equipment), not clothing, not
 * heavy items (>= 1 stone), and not coins — `money` is its own item type, so it
 * is excluded by the type filter.
 */
function harnessEligible6(actor, harnessId) {
  return actor.items
    .filter((i) => i.id !== harnessId)
    .filter((i) => i.type === "item" && i.system?.subtype !== "clothing")
    .filter((i) => Number(i.system?.weight6 ?? 0) < STONE)
    .reduce((sum, i) => sum + itemWeight6(i), 0);
}

/** Worn armour category, for the harness's "not over heavy armour" clause. */
function wornArmourType(actor) {
  const worn = actor.items.find((i) => i.type === "armor" && i.system?.equipped && i.system?.type !== "shield" && !/helm/i.test(i.name ?? ""));
  return worn?.system?.type ?? "unarmored";
}

/**
 * Correction (in weight6) to core's flat encumbrance sum. Negative = lighter.
 * Returns 0 when nothing RAW-specific applies — the common case.
 */
export function encumbranceDelta6(actor) {
  let delta = 0;

  // 1. Adventurer's harness: ignore up to 1 stone of ordinary equipment.
  const harness = actor.items.find(
    (i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.HARNESS) && i.system?.equipped,
  );
  if (harness && wornArmourType(actor) !== "heavy") {
    delta -= Math.min(STONE, harnessEligible6(actor, harness.id));
  }

  // 2. Bowquiver: the assembly counts as 2 items when holding anything, 1 when
  //    empty — rather than quiver + bow + arrows summed.
  for (const q of actor.items.filter((i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.BOWQUIVER))) {
    const contents = contentsOf(actor, q.id);
    const flat = itemWeight6(q) + contentsWeight6(actor, q.id);
    const raw = contents.length ? 2 : 1; // items, i.e. 2/6 or 1/6 stone
    delta += raw - flat;
  }

  return delta;
}
