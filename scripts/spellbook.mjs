/* global game, ui */
/**
 * Spellbooks — RR p. 145 (the item) and p. 390 (value of a scribed spell).
 *
 * A spell book is a special container that records spell FORMULAE, not gear. RAW:
 * a grimoire has 100 pages; each spell takes one page per spell level; the book
 * counts as 1/2 stone (three items) whatever it holds; a blank book costs 20gp.
 *
 * Because a captured book's spells are NOT the finder's known repertoire, the
 * spell list is stored as DATA on the book (name + level) rather than by linking
 * the actor's own spell documents — so the list travels with the book when it is
 * looted, and appears on nobody's Spells tab until it is actually learned.
 *
 * Value follows the Magic Research material cost (RR p390): 1,000gp per spell
 * level. So a book's worth is the blank cost plus 1,000gp × the level of every
 * spell scribed in it.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";

export const SPELLBOOK_PAGES = 100; // RR p145
export const SPELL_VALUE_PER_LEVEL = 1000; // RR p390 (Material Cost)
export const BLANK_SPELLBOOK_VALUE = 20; // RR p145
export const SPELLBOOK_WEIGHT6 = 3; // 1/2 stone

/** The spellbook record on an item, or null. */
export function spellbookOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK) ?? null;
}
export function isSpellbook(item) {
  return !!spellbookOf(item);
}

/** The spells recorded in the book: [{name, lvl}], always an array. */
export function spellbookSpells(item) {
  const s = spellbookOf(item)?.spells;
  return Array.isArray(s) ? s : [];
}

/** Page capacity (RR default 100). */
export function pagesCapacity(item) {
  return Number(spellbookOf(item)?.pages ?? SPELLBOOK_PAGES);
}

/** Pages used — one page per spell level (a 3rd-level spell fills three pages). */
export function pagesUsed(item) {
  return spellbookSpells(item).reduce((n, sp) => n + Math.max(0, Number(sp.lvl ?? 0)), 0);
}

/** Is the book scribed past its page capacity? */
export function overCapacity(item) {
  return pagesUsed(item) > pagesCapacity(item);
}

/** RAW value: blank cost + 1,000gp × the level of every spell scribed. */
export function spellbookValue(item) {
  return BLANK_SPELLBOOK_VALUE + spellbookSpells(item).reduce((gp, sp) => gp + SPELL_VALUE_PER_LEVEL * Math.max(0, Number(sp.lvl ?? 0)), 0);
}

/**
 * Parse a free-text spell list — one spell per line, level as a trailing number
 * or "(N)" ("Fireball, 3" / "Fireball (3)" / "Fireball 3"). A line with no level
 * defaults to 1. Blank lines are ignored.
 * @returns {{name:string, lvl:number}[]}
 */
export function parseSpellList(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s,(]*\(?(\d+)\)?\s*$/.exec(line);
    if (m && m[1].trim()) out.push({ name: m[1].trim().replace(/[,(]\s*$/, "").trim(), lvl: parseInt(m[2], 10) });
    else out.push({ name: line, lvl: 1 });
  }
  return out;
}

/** Render a spell list back to editable text ("Fireball, 3"). */
export function formatSpellList(spells) {
  return (spells ?? []).map((sp) => `${sp.name}, ${sp.lvl}`).join("\n");
}

/** Flag an item as a spellbook (RR: 100 pages, 1/2 stone, 20gp blank). */
export async function makeSpellbook(item, pages = SPELLBOOK_PAGES) {
  if (!item) return;
  const update = {};
  // A spell book weighs 1/2 stone and a blank one is worth 20gp — set them if the
  // item does not already carry sensible values (never clobber a deliberate one).
  if (!Number(item.system?.weight6 ?? 0)) update["system.weight6"] = SPELLBOOK_WEIGHT6;
  if (!Number(item.system?.cost ?? 0)) update["system.cost"] = BLANK_SPELLBOOK_VALUE;
  if (Object.keys(update).length) await item.update?.(update);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK, { pages, spells: spellbookSpells(item) });
}

/** Stop treating an item as a spellbook (leaves cost/weight as-is). */
export async function unmakeSpellbook(item) {
  await item?.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK);
}

/** Replace the book's spell list (validated to {name, lvl}). */
export async function setSpellbookSpells(item, spells) {
  const rec = spellbookOf(item) ?? { pages: SPELLBOOK_PAGES };
  const clean = (spells ?? [])
    .map((sp) => ({ name: String(sp.name ?? "").trim(), lvl: Math.max(0, parseInt(sp.lvl, 10) || 0) }))
    .filter((sp) => sp.name);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SPELLBOOK, { ...rec, spells: clean });
  if (overCapacity(item) && game?.i18n) {
    ui.notifications?.warn?.(
      game.i18n.has("ACKS-EQUIPMENT.spellbook.over")
        ? game.i18n.format("ACKS-EQUIPMENT.spellbook.over", { name: item.name, used: pagesUsed(item), cap: pagesCapacity(item) })
        : `${item.name}: ${pagesUsed(item)}/${pagesCapacity(item)} pages — over capacity.`,
    );
  }
}
