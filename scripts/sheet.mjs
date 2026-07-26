/* global game, Hooks, document, ui, foundry, fromUuid */
/**
 * ACKS character-sheet integration — wear-location buckets on the Inventory tab.
 *
 * Core groups inventory strictly by ITEM TYPE (weapons / armour / items /
 * clothing / money), so "what is this character actually wearing, and where?"
 * was only answerable through theripper93's Paper Doll — a separate premium
 * module — or the Loadout Inspector macro. This puts the same information on
 * the sheet every table already has.
 *
 * Technique (deliberately non-invasive): core's sheet is an ApplicationV2 whose
 * `[data-action]` handlers are bound by DELEGATION on the application root. So
 * we do not re-render, re-template, or clone anything — we MOVE core's own
 * `<li>` rows into our buckets. Every core control on those rows (equip toggle,
 * favourite, summary expand, delete, drag) keeps working untouched, and the
 * next re-render rebuilds core's markup from scratch, so nothing is persisted
 * or corrupted. Rows we do not claim stay exactly where core put them.
 *
 * HANDOFF: if the system ever groups inventory by an extensible bucket list of
 * its own, this file should be deleted in favour of contributing to it.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR_ICONS, SHIELD_VARIANTS } from "./config.mjs";
import { getLoadout, cycleGrip } from "./loadout.mjs";
import {
  prepareTorch, rollUnarmed, setMasterwork, masterworkTiersFor, drawItem, sheatheItem,
  scavengeItem, clearScavenged, setScavengedRow, scavengedOptions, setShieldVariant, SHIELD_VARIANT_KEYS,
  disguiseItem, revealItem,
} from "./actions.mjs";
import { masterworkTierOf, scavengedOf, layerSummary } from "./properties.mjs";
import { classifyWeapon } from "./profiles.mjs";
import { cycleStrap, strapOf, variantOf, overlayEnabled as shieldOverlayEnabled } from "./overlays/shield-variants.mjs";
import { overlayEnabled as scavengedOverlayEnabled, tableFor } from "./overlays/scavenged.mjs";
import { helmetType, isHelmet } from "./overlays/enclosing-helm.mjs";
import {
  isSpellbook, spellbookSpells, pagesUsed, pagesCapacity,
  spellbookValue, setSpellbookSpells, parseSpellList, formatSpellList,
} from "./spellbook.mjs";
import { MATERIALS, MATERIALS_BY_DAMAGE_TYPE, setMaterial, materialOf } from "./overlays/item-loss.mjs";
import { wearBuckets, wearLabel } from "./wear.mjs";
import {
  containerReport,
  STONE,
  isContainer,
  emptyContainer,
  setConcealed,
  setLocked,
  setOpened,
  storeIn,
  takeOut,
} from "./containers.mjs";
import { pickLock, bashOpen, canPick, canBash } from "./locks.mjs";
import { annotateItem } from "./api.mjs";
import { injectDollHeaderButton } from "./paperdoll.mjs";

/** Stone display shared with the container app. */
function st(weight6) {
  return String(Number(weight6 / STONE).toFixed(2)).replace(/\.?0+$/, "") || "0";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A bucket header: icon, label, and an optional right-aligned note. */
function bucketHeader(iconKey, label, note) {
  const header = el("header", "acks-equipment-wear__bucket-header");
  const icon = el("i", `fas ${WEAR_ICONS[iconKey] ?? "fa-circle"}`);
  header.append(icon, el("span", "acks-equipment-wear__bucket-label", label));
  if (note) header.append(el("span", "acks-equipment-wear__bucket-note", note));
  return header;
}

/**
 * Move the rows for `items` out of core's type lists into `list`.
 * @returns {number} how many rows were actually claimed
 */
function claimRows(tab, items, list, wearKey) {
  let claimed = 0;
  for (const item of items) {
    // Scope the lookup to core's own lists so we never re-claim a row we have
    // already moved (which would reorder buckets on a double fire).
    const row = tab.querySelector(`.item-list > li.item[data-item-id="${item.id}"]`);
    if (!row) continue;
    row.dataset.wear = wearKey;
    list.appendChild(row);
    claimed++;
  }
  return claimed;
}

/** Build the "Worn & Wielded" section, or null when nothing is equipped. */
function buildWornSection(actor, tab, loadout) {
  const buckets = wearBuckets(actor, loadout);

  const section = el("section", "acks-equipment-wear item-list-section");
  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.wear.section")));

  // The two facts a player checks constantly, next to the gear that drives them.
  const style = loadout.styleProficient ? "" : ` — ${game.i18n.localize("ACKS-EQUIPMENT.wear.untrained")}`;
  head.append(
    el(
      "span",
      `acks-equipment-wear__status${loadout.styleProficient ? "" : " advisory"}`,
      game.i18n.format("ACKS-EQUIPMENT.wear.status", {
        used: loadout.handsUsed,
        budget: loadout.handBudget,
        style: wearLabel(`style.${loadout.activeStyle}`),
      }) + style,
    ),
  );
  section.append(head);

  let moved = 0;
  for (const { key, items } of buckets) {
    const bucket = el("div", `acks-equipment-wear__bucket acks-equipment-wear__bucket--${key}`);
    const list = el("ul", "item-list unlist");
    const claimed = claimRows(tab, items, list, key);
    if (!claimed) continue;
    moved += claimed;
    injectGripControls(list, loadout);
    bucket.append(bucketHeader(key, wearLabel(key)), list);
    section.append(bucket);
  }

  // Unarmed: an empty-handed character always has a strike (RR p299, 1d3
  // nonlethal) — a mode, not the absence of one. Shown whenever no weapon is
  // wielded, so it appears even for a character carrying nothing at all.
  let unarmed = false;
  if (!loadout.weapons.length) {
    const bucket = el("div", "acks-equipment-wear__bucket acks-equipment-wear__bucket--unarmed");
    const list = el("ul", "item-list unlist");
    const row = el("li", "item acks-equipment-unarmed");
    row.append(el("span", "acks-equipment-unarmed__label", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")));
    if (actor.isOwner) {
      const strike = el("a", "item-control acks-equipment-unarmed__strike");
      strike.innerHTML = `<i class="fas fa-hand-fist"></i>`;
      strike.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.action.unarmedHint");
      strike.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        rollUnarmed(actor);
      });
      row.append(strike);
    }
    list.append(row);
    bucket.append(bucketHeader("mainHand", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")), list);
    section.append(bucket);
    unarmed = true;
  }
  return moved || unarmed ? section : null;
}

/** A light source's formation light type from its name, or null. A torch is a
 * WEAPON (RR: 1d4), lanterns/candles are items — so match by name, not type. */
function lightTypeOf(item) {
  const n = String(item?.name ?? "").toLowerCase();
  if (/lantern/.test(n)) return "lantern";
  if (/torch/.test(n)) return "torch";
  if (/candle/.test(n)) return "candle";
  return null;
}

/**
 * Put light controls on each equipped light source — Light / Douse, plus Shutter
 * for a lantern. These drive acks-formation's light state by actor (the module
 * owns it; this is the sheet-side control the two-way hook enables). No
 * formation module, or the actor is not in a party formation → no controls
 * (nothing to hold the light record). GM/owner authoritative, like the party
 * sheet's own light buttons.
 */
function injectLightControls(list, actor) {
  const fm = globalThis.acksFormation;
  if (!fm?.getFormationForActor) return;
  const formation = fm.getFormationForActor(actor.id);
  if (!formation) return;
  const mine = (formation.lights ?? []).filter((l) => l.bearerId === actor.id);
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    const type = lightTypeOf(item);
    // A light source is type `item` and has no `equipped` field — the control
    // shows on the item itself; "held" is the formation light record, below.
    if (!type || li.querySelector(".acks-equipment-light")) continue;
    const controls = li.querySelector(".list-header__controls") ?? li.querySelector(".item-row") ?? li;
    // A TORCH carried as a STACK (an `item`, not a wielded weapon) gets a "Ready"
    // control instead — but that is a pure equipment action, so it lives in
    // injectTorchReady (which runs without acks-formation). Skip it here so a
    // torch bundle never also picks up a formation Light control.
    if (type === "torch" && item.type === "item") continue;
    const lit = mine.find((l) => l.type === type && l.lit);
    const held = lit || mine.find((l) => l.type === type && l.shielded);
    const add = (icon, key, run) => {
      const a = el("a", "item-control acks-equipment-light");
      a.innerHTML = `<i class="fas ${icon}"></i>`;
      a.dataset.tooltip = game.i18n.localize(key);
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        Promise.resolve(run()).catch((err) => console.error(`${MODULE_ID} | light control failed`, err));
      });
      controls.insertBefore(a, controls.firstChild);
    };
    if (held) {
      // Douse (and re-light) the held source; shutter a lantern.
      add("fa-fire", "ACKS-EQUIPMENT.light.douse", () => fm.toggleLight(fm.getFormationForActor(actor.id), held.id));
      if (type === "lantern") add("fa-lightbulb", "ACKS-EQUIPMENT.light.shutter", () => fm.toggleShield(fm.getFormationForActor(actor.id), held.id));
    } else {
      add("fa-fire-flame-curved", "ACKS-EQUIPMENT.light.light", () => fm.addLight(fm.getFormationForActor(actor.id), type, actor.id));
    }
  }
}

/**
 * Put a grip control on each versatile weapon's row. A versatile weapon can be
 * wielded one- or two-handed; the control shows the resolved grip and cycles
 * the player's choice (Auto → 1H → 2H). Two-handing needs both hands free — a
 * "2H" choice that cannot be honoured (a shield or second weapon is in the way)
 * shows as BLOCKED, which is the visible "check against free hands".
 */
function injectGripControls(list, loadout) {
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const entry = loadout.weapons.find((w) => w.item.id === li.dataset.itemId);
    if (!entry?.canTwoHand || li.querySelector(".acks-equipment-grip")) continue;
    const state = entry.gripBlocked ? "blocked" : entry.wieldTwoHanded ? "twoHand" : "oneHand";
    const label = { blocked: "2H ✗", twoHand: "2H", oneHand: "1H" }[state];
    const badge = entry.grip === "auto" ? " · auto" : "";
    const a = el("a", `item-control acks-equipment-grip acks-equipment-grip--${state}`);
    a.innerHTML = `<i class="fas fa-hands"></i> ${label}${badge}`;
    a.dataset.tooltip = game.i18n.format(
      entry.gripBlocked ? "ACKS-EQUIPMENT.grip.blocked" : "ACKS-EQUIPMENT.grip.cycle",
      { grip: game.i18n.localize(`ACKS-EQUIPMENT.grip.${entry.grip}`) },
    );
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // The flag change fires updateItem → the sheet re-renders → fresh buckets.
      cycleGrip(entry.item).catch((err) => console.error(`${MODULE_ID} | grip cycle failed`, err));
    });
    const controls = li.querySelector(".list-header__controls") ?? li.querySelector(".item-row") ?? li;
    controls.insertBefore(a, controls.firstChild);
  }
}

/** The controls container within an inventory row (where item-control links go). */
function rowControls(li) {
  return li.querySelector(".list-header__controls") ?? li.querySelector(".item-row") ?? li;
}

/**
 * "Ready" control on every torch STACK (a light `item` bundle). Pulls one torch
 * out as a wieldable 1d4 light-weapon (prepareTorch) and decrements the bundle.
 * Independent of acks-formation — readying a torch is a pure equipment action —
 * so unlike the light/douse controls it renders whether or not the actor is in a
 * party formation.
 */
function injectTorchReady(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== "item" || lightTypeOf(item) !== "torch" || li.querySelector(".acks-equipment-ready")) continue;
    const a = el("a", "item-control acks-equipment-ready");
    a.innerHTML = `<i class="fas fa-fire-flame-simple"></i>`;
    a.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.action.readyHint");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      prepareTorch(actor, item).catch((err) => console.error(`${MODULE_ID} | ready torch failed`, err));
    });
    rowControls(li).insertBefore(a, rowControls(li).firstChild);
  }
}

/**
 * Draw / sheathe every weapon row: a wielded weapon gets a Sheathe control, a
 * carried one a Draw control — core's equip toggle with a combat verb, sitting in
 * the same control row as grip and masterwork (the "Equip / Unequip on a separate
 * button" of the grip UI brief). A thrown-away weapon is skipped: it is recovered
 * when picked up, not re-drawn.
 */
function injectDrawSheathe(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== "weapon" || li.querySelector(".acks-equipment-draw")) continue;
    if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE)) continue;
    const equipped = !!item.system?.equipped;
    const a = el("a", `item-control acks-equipment-draw acks-equipment-draw--${equipped ? "sheathe" : "draw"}`);
    a.innerHTML = `<i class="fas ${equipped ? "fa-box-archive" : "fa-hand-fist"}"></i>`;
    a.dataset.tooltip = game.i18n.localize(`ACKS-EQUIPMENT.action.${equipped ? "sheathe" : "draw"}`);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      (equipped ? sheatheItem(item) : drawItem(item)).catch((err) => console.error(`${MODULE_ID} | draw/sheathe failed`, err));
    });
    rowControls(li).insertBefore(a, rowControls(li).firstChild);
  }
}


/**
 * Strap control on every shield row (gated on the shield-variant overlay). A
 * shield can be carried IN HAND (ready) or slung to BACK / FRONT; strapped it
 * costs no hand (RR/JJ p407), which is how a hand is freed for a torch while the
 * shield still rides. Cycles hand → back → front, skipping any position the
 * shield cannot take (a kite/phalanx shield has no back).
 */
function injectStrapControls(tab, actor) {
  if (!actor?.isOwner || !shieldOverlayEnabled()) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== "armor" || item.system?.type !== "shield" || li.querySelector(".acks-equipment-strap")) continue;
    const strap = strapOf(item);
    const a = el("a", `item-control acks-equipment-strap acks-equipment-strap--${strap}`);
    a.innerHTML = `<i class="fas ${strap === "hand" ? "fa-hand" : "fa-shield-halved"}"></i> ${game.i18n.localize(`ACKS-EQUIPMENT.strap.${strap}`)}`;
    a.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.strap.cycle");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cycleStrap(item).catch((err) => console.error(`${MODULE_ID} | strap cycle failed`, err));
    });
    rowControls(li).insertBefore(a, rowControls(li).firstChild);
  }
}


/** Chat card summarising a scavenged roll (d20s + the mechanical condition). */
async function postScavengeCard(item, { rolls, cond }) {
  const mech = [];
  if (cond.attack) mech.push(`${cond.attack} attack`);
  if (cond.damage) mech.push(`${cond.damage} damage`);
  if (cond.ac) mech.push(`${cond.ac} AC`);
  if (cond.encumbrance) mech.push(`+${cond.encumbrance} stone`);
  if (cond.initiative) mech.push(`${cond.initiative} initiative`);
  if (cond.breaks) mech.push("breaks on a natural 1");
  if (cond.cannotSneak) mech.push("cannot sneak/hide");
  const labels = cond.labels.length ? cond.labels.join("; ") : "Serviceable";
  const content =
    `<div class="acks-equipment-scavenge-card"><strong>${item.name}</strong> — ` +
    `${game.i18n.localize("ACKS-EQUIPMENT.action.scavenge")} (d20: ${rolls.join(", ")})<br>${labels}` +
    `${mech.length ? `<br><em>${mech.join(", ")}</em>` : ""}` +
    `<br>${Math.round(cond.valueMultiplier * 100)}% of normal value</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: item.parent }) });
}


/** A small icon control in a container's header. */
function ctrl(icon, tooltipKey, onClick, extraClass = "") {
  const a = el("a", `item-control acks-equipment-container__ctrl ${extraClass}`.trim());
  a.innerHTML = `<i class="fas ${icon}"></i>`;
  a.dataset.tooltip = game.i18n.localize(tooltipKey);
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    Promise.resolve(onClick()).catch((err) => console.error(`${MODULE_ID} | container control failed`, err));
  });
  return a;
}

/**
 * One container's header: name, load, and every control that used to live in
 * the popout window.
 *
 * The popout existed because there was nowhere else to put these. There is now:
 * the container sits on the equipment tab next to the gear it holds, and
 * "opening" it here is the same gesture as opening it at the table.
 */
function containerHeader(actor, c, onRerender) {
  const header = el("header", "acks-equipment-wear__bucket-header acks-equipment-container__header");

  // Open/collapse is the primary gesture, so the whole header toggles it — but
  // a locked container has nothing to show, so it does not pretend to open.
  const foldable = c.visible;
  const icon = el("i", `fas ${c.locked ? "fa-lock" : c.concealed ? "fa-box" : "fa-box-open"}`);
  header.append(icon, el("span", "acks-equipment-wear__bucket-label", c.item.name));

  const note = c.capacityStone ? `${st(c.load6)} / ${c.capacityStone} st` : `${st(c.load6)} st`;
  header.append(el("span", "acks-equipment-wear__bucket-note", note));

  const controls = el("div", "acks-equipment-container__controls");

  if (foldable) {
    controls.append(
      ctrl(
        c.concealed ? "fa-chevron-right" : "fa-chevron-down",
        c.concealed ? "ACKS-EQUIPMENT.container.expand" : "ACKS-EQUIPMENT.container.collapse",
        async () => {
          await setConcealed(c.item, !c.concealed);
          onRerender();
        },
      ),
    );
  }

  if (actor.isOwner) {
    // Lock / unlock. A player holding the key can shut it again; defeating a
    // lock does not remove it.
    controls.append(
      ctrl(c.locked ? "fa-unlock" : "fa-lock", c.locked ? "ACKS-EQUIPMENT.container.unlock" : "ACKS-EQUIPMENT.container.lock", async () => {
        if (c.locked) await setOpened(c.item, true);
        else await setLocked(c.item, true);
        onRerender();
      }),
    );

    if (c.locked) {
      // Only offered when the character actually has the proficiency — a
      // control that always fails teaches nothing.
      if (canPick(actor)) {
        controls.append(
          ctrl("fa-key", "ACKS-EQUIPMENT.container.pick", async () => {
            await pickLock(actor, c.item);
            onRerender();
          }),
        );
      }
      if (canBash(actor)) {
        controls.append(
          ctrl("fa-hammer", "ACKS-EQUIPMENT.container.bash", async () => {
            // Bashing destroys the container, and a fragile one takes its
            // contents with it. That is not undoable, so it is confirmed.
            const warning = c.fragile
              ? game.i18n.format("ACKS-EQUIPMENT.container.bashConfirmFragile", { name: c.item.name })
              : game.i18n.format("ACKS-EQUIPMENT.container.bashConfirm", { name: c.item.name });
            const ok = await foundry.applications.api.DialogV2.confirm({
              window: { title: game.i18n.localize("ACKS-EQUIPMENT.container.bash") },
              content: `<p>${warning}</p>`,
              rejectClose: false,
            });
            if (ok) {
              await bashOpen(actor, c.item);
              onRerender();
            }
          }),
        );
      }
    }

    controls.append(
      ctrl("fa-box-open", "ACKS-EQUIPMENT.container.empty", async () => {
        const n = await emptyContainer(actor, c.item);
        if (n) ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.emptied", { n, name: c.item.name }));
        onRerender();
      }),
      ctrl("fa-times", "ACKS-EQUIPMENT.container.unmake", async () => {
        await emptyContainer(actor, c.item);
        await c.item.unsetFlag(MODULE_ID, "container");
        onRerender();
      }),
    );
  }

  header.append(controls);
  return header;
}

/** Build the "Stowed" section — one bucket per container, with its controls. */
function buildStowedSection(actor, tab) {
  const report = containerReport(actor);
  const section = el("section", "acks-equipment-wear acks-equipment-stowed item-list-section");
  const rerender = () => {}; // re-render is driven by the document update hooks

  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.wear.stowedSection")));

  // Turning gear into containers is a bulk action over the whole inventory, so
  // it stays at the section level rather than repeating on every row.
  if (actor.isOwner) {
    head.append(
      ctrl("fa-wand-magic-sparkles", "ACKS-EQUIPMENT.container.annotateAll", async () => {
        let n = 0;
        for (const item of actor.items) {
          if (item.type !== "item" || isContainer(item)) continue;
          if (await annotateItem(item)) n++;
        }
        ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.annotated", { n }));
      }),
    );
  }
  section.append(head);

  let moved = 0;
  for (const c of report) {
    const bucket = el("div", `acks-equipment-wear__bucket acks-equipment-container${c.over ? " over" : ""}${c.locked ? " locked" : ""}`);
    bucket.dataset.dropTarget = c.item.id;
    bucket.append(containerHeader(actor, c, rerender));

    if (c.visible && !c.concealed) {
      const list = el("ul", "item-list unlist");
      moved += claimRows(tab, c.contents, list, "stowed");
      bucket.append(list);
    } else if (!c.visible) {
      // Say WHY it is empty. A locked chest showing nothing looks like a bug;
      // a locked chest saying it is locked is the game working.
      bucket.append(el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.container.lockedHint")));
    }

    section.append(bucket);
  }

  // With no containers at all, say how to make one rather than showing a box.
  if (!report.length) {
    const hint = el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.wear.noContainers"));
    section.append(hint);
  }
  return moved || !report.length || report.some((c) => !c.visible || c.concealed) ? section : null;
}

/**
 * Make the container buckets accept dropped gear.
 *
 * Core's own inventory rows are already draggable and emit the standard
 * `{type:"Item", uuid}` payload, so dragging from the type lists into a
 * container works without touching how core builds those rows. Dropping onto
 * the "loose" zone takes an item back out.
 */
function wireDropTargets(actor, root) {
  for (const zone of root.querySelectorAll("[data-drop-target]")) {
    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      zone.classList.add("drop-hover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drop-hover"));
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      zone.classList.remove("drop-hover");
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return; // not a Foundry drag payload
      }
      if (data?.type !== "Item" || !data.uuid) return;

      const item = await fromUuid(data.uuid);
      // Only this actor's own embedded items are stowed. A drop from a
      // compendium or another actor is a copy operation we deliberately
      // do not perform behind the player's back.
      if (!item || item.parent?.id !== actor.id) {
        ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.container.foreignItem"));
        return;
      }
      const target = zone.dataset.dropTarget;
      if (target === "loose") await takeOut(item);
      else await storeIn(actor, item, actor.items.get(target));
    });
  }
}

function regroup(actor, tab) {
  const loadout = getLoadout(actor);
  const worn = buildWornSection(actor, tab, loadout);
  const stowed = buildStowedSection(actor, tab);
  if (!worn && !stowed) return;

  // Slot in below the encumbrance bar, above core's type lists.
  const column = tab.querySelector(".content > .flexcol") ?? tab.querySelector(".content") ?? tab;
  const anchor = column.querySelector(".encumbrance-panel");
  const after = anchor?.nextSibling ?? column.firstChild;
  for (const node of [worn, stowed].filter(Boolean)) column.insertBefore(node, after);

  // Core's own type lists are the "take it back out" target: dragging a stowed
  // item back down to the ordinary inventory un-stows it.
  const loose = column.querySelector(".item-list-section:not(.acks-equipment-wear)");
  if (loose) loose.dataset.dropTarget = "loose";

  if (actor.isOwner) wireDropTargets(actor, column);
}

/**
 * The "ACKS Properties" panel on an ITEM's own sheet — the home for everything
 * that describes WHAT an item is (as opposed to how a character is using it,
 * which lives on the inventory rows). One place to set masterwork, a scavenged
 * condition, material, a shield variant, a helmet's weight, a spellbook, or a GM
 * apparent-identity — on any weapon, armour, or item, whether or not it is on an
 * actor. Reuses the same dialogs the inventory-row controls use.
 */
function injectItemProperties(app, element) {
  try {
    const item = app?.item ?? app?.document;
    if (item?.documentName !== "Item" || !["weapon", "armor", "item"].includes(item.type)) return;
    const form = element?.querySelector?.("form") ?? element;
    if (!form || form.querySelector(".acks-equipment-props")) return;

    const section = el("section", "acks-equipment-props");
    section.append(el("h3", "acks-equipment-props__title", game.i18n.localize("ACKS-EQUIPMENT.props.section")));
    const row = (labelKey, control) => {
      const g = el("div", "acks-equipment-props__row");
      g.append(el("label", "acks-equipment-props__label", game.i18n.localize(labelKey)), control);
      section.append(g);
    };
    const guard = (fn) => Promise.resolve(fn()).catch((e) => console.error(`${MODULE_ID} | item property`, e));
    /** A small inline button (an ACTION — rolling, applying, revealing). */
    const button = (text, tooltipKey, onClick, extraClass = "") => {
      const b = el("button", `acks-equipment-props__btn ${extraClass}`.trim(), text);
      b.type = "button";
      if (tooltipKey) b.dataset.tooltip = game.i18n.localize(tooltipKey);
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        guard(onClick);
      });
      return b;
    };
    // OUR CONTROLS LIVE INSIDE CORE'S <form>, and an ApplicationV2 sheet submits
    // on change: an un-stopped change event bubbles to core's delegated handler,
    // which re-renders the sheet from ITS form data — throwing away the write we
    // were in the middle of making. (Symptom: picking a masterwork tier or a
    // condition appeared to do nothing at all, because nothing persisted.) So
    // every control's change is stopped here before it reaches the form.
    const onChange = (node, handler) =>
      node.addEventListener("change", (ev) => {
        ev.stopPropagation();
        guard(handler);
      });
    /** A dropdown bucket — the default control for "which one is this?". */
    const select = (options, current, onPick) => {
      const s = el("select", "acks-equipment-props__select");
      s.innerHTML = options.map((o) => `<option value="${o.value}">${foundry.utils.escapeHTML?.(o.label) ?? o.label}</option>`).join("");
      s.value = current;
      onChange(s, () => onPick(s.value));
      return s;
    };
    /** An entry field that commits on change/blur. */
    const field = (value, onCommit, type = "text") => {
      const i = el("input", "acks-equipment-props__input");
      i.type = type;
      i.value = value ?? "";
      onChange(i, () => onCommit(i.value));
      return i;
    };
    /** Group several controls on one row. */
    const group = (...nodes) => {
      const g = el("div", "acks-equipment-props__group");
      g.append(...nodes);
      return g;
    };

    if (item.type === "weapon" || item.type === "armor") {
      // MASTERWORK — a bucket of the RR p159 tiers.
      const tier = masterworkTierOf(item) ?? "none";
      row("ACKS-EQUIPMENT.props.masterwork", select(
        [{ value: "none", label: game.i18n.localize("ACKS-EQUIPMENT.masterwork.none") },
          ...masterworkTiersFor(item.type).map((t) => ({ value: t, label: game.i18n.localize(`ACKS-EQUIPMENT.masterwork.${t}`) }))],
        tier,
        (v) => setMasterwork(item, v),
      ));

      // CONDITION — pick a row of the applicable scavenged table directly, or
      // roll it. Both read the reader's OWN imported table (RR p160, extracted
      // by acks-content) when the world has one; the built-in RAW table is the
      // fallback. "Pristine" clears.
      const profile = item.type === "weapon" ? classifyWeapon(item) : null;
      const tableKey = tableFor(item, profile);
      const opts = scavengedOptions(tableKey);
      const sc = scavengedOf(item);
      const cur = sc?.labels?.length === 1 ? String(opts.find((o) => o.label === sc.labels[0])?.value ?? "none") : "none";
      const picker = select(
        [{ value: "none", label: game.i18n.localize("ACKS-EQUIPMENT.props.pristine") },
          ...opts.map((o) => ({ value: String(o.value), label: o.label }))],
        cur,
        (v) => (v === "none" ? clearScavenged(item) : setScavengedRow(item, tableKey, v)),
      );
      // A stacked condition (a 19-20 reroll produced several) has no single row —
      // say so rather than showing one of them as if it were the whole story.
      if (sc?.labels?.length > 1) picker.dataset.tooltip = sc.labels.join("; ");
      row("ACKS-EQUIPMENT.props.condition", group(
        picker,
        button(game.i18n.localize("ACKS-EQUIPMENT.action.scavengeRoll"), "ACKS-EQUIPMENT.action.scavengeHint",
          async () => { const r = await scavengeItem(item); if (r) await postScavengeCard(item, r); }, "narrow"),
      ));

      const summary = layerSummary(item);
      if (summary) row("ACKS-EQUIPMENT.props.net", el("span", "acks-equipment-props__note", summary));
    }

    // MATERIAL (any physical item) — "Auto" clears the flag → the name/type guess.
    row("ACKS-EQUIPMENT.props.material", select(
      [{ value: "auto", label: game.i18n.format("ACKS-EQUIPMENT.props.materialAuto", { guess: materialOf(item) }) },
        ...MATERIALS.map((m) => ({ value: m, label: m }))],
      String(item.getFlag(MODULE_ID, ITEM_FLAGS.MATERIAL) ?? "auto").toLowerCase(),
      (v) => setMaterial(item, v),
    ));
    // Material has no standing modifier — it decides WHICH damage types can
    // destroy the item (JJ p398 item loss). Saying so stops it reading as a
    // setting that silently does nothing.
    const mat = materialOf(item);
    const harms = Object.entries(MATERIALS_BY_DAMAGE_TYPE).filter(([, list]) => list.includes(mat)).map(([dt]) => dt);
    row("", el("span", "acks-equipment-props__note",
      harms.length
        ? game.i18n.format("ACKS-EQUIPMENT.props.materialNote", { types: harms.join(", ") })
        : game.i18n.localize("ACKS-EQUIPMENT.props.materialNoneNote")));

    if (item.type === "armor" && item.system?.type === "shield") {
      row("ACKS-EQUIPMENT.props.variant", select(
        SHIELD_VARIANT_KEYS.map((k) => ({ value: k, label: SHIELD_VARIANTS[k]?.label ?? k })),
        item.getFlag(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT) ?? "standard",
        (v) => setShieldVariant(item, v),
      ));
    }
    if (isHelmet(item)) {
      row("ACKS-EQUIPMENT.props.helm", select(
        [{ value: "light", label: game.i18n.localize("ACKS-EQUIPMENT.helm.light") },
          { value: "heavy", label: game.i18n.localize("ACKS-EQUIPMENT.helm.heavy") }],
        helmetType(item),
        (v) => item.setFlag(MODULE_ID, ITEM_FLAGS.HELMET, v),
      ));
    }
    // A spell book is a RECOGNISED item (the RR "Spell Book"), so the list shows
    // only ON one — never a "make any item a spell book" toggle. Edited in place.
    if (isSpellbook(item)) {
      const ta = el("textarea", "acks-equipment-props__spells");
      ta.rows = 5;
      ta.value = formatSpellList(spellbookSpells(item));
      ta.placeholder = game.i18n.localize("ACKS-EQUIPMENT.spellbook.prompt");
      onChange(ta, () => setSpellbookSpells(item, parseSpellList(ta.value)));
      row("ACKS-EQUIPMENT.props.spellbook", ta);
      row("", el("span", "acks-equipment-props__note",
        `${pagesUsed(item)}/${pagesCapacity(item)} pages · ${spellbookValue(item)}gp`));
    }
    if (game.user?.isGM) {
      // APPARENT IDENTITY — entry fields the GM fills in, applied on demand.
      const d = item.getFlag(MODULE_ID, ITEM_FLAGS.DISGUISE);
      const ap = d?.apparent ?? {};
      const draft = { name: ap.name ?? item.name, cost: ap.cost ?? item.system?.cost ?? 0,
        damage: ap.damage ?? item.system?.damage ?? "", ac: ap.ac ?? item.system?.aac?.value ?? 0 };
      const nameF = field(draft.name, (v) => { draft.name = v; });
      const costF = field(draft.cost, (v) => { draft.cost = v; }, "number");
      const statF = item.type === "weapon" ? field(draft.damage, (v) => { draft.damage = v; })
        : item.type === "armor" ? field(draft.ac, (v) => { draft.ac = v; }, "number") : null;
      row("ACKS-EQUIPMENT.props.disguise", group(
        nameF, costF, ...(statF ? [statF] : []),
        button(game.i18n.localize(d ? "ACKS-EQUIPMENT.disguise.update" : "ACKS-EQUIPMENT.disguise.apply"),
          "ACKS-EQUIPMENT.disguise.hint",
          () => disguiseItem(item, { name: nameF.value, cost: costF.value, ...(item.type === "weapon" ? { damage: statF.value } : {}), ...(item.type === "armor" ? { ac: statF.value } : {}) }),
          d ? "narrow active" : "narrow"),
        ...(d ? [button(game.i18n.localize("ACKS-EQUIPMENT.disguise.reveal"), "ACKS-EQUIPMENT.disguise.activeHint", () => revealItem(item), "narrow")] : []),
      ));
      // The state line is the ONLY way a GM can tell a disguise is on — the item
      // deliberately looks mundane everywhere else — so it always says which it
      // is, and names the truth waiting underneath.
      row("", el("span", `acks-equipment-props__note${d ? " acks-equipment-props__note--warn" : ""}`,
        d
          ? game.i18n.format("ACKS-EQUIPMENT.disguise.shown", { name: d.true?.name ?? "?" })
          : game.i18n.localize("ACKS-EQUIPMENT.disguise.off")));
    }

    form.appendChild(section);
  } catch (err) {
    console.error(`${MODULE_ID} | item property panel failed`, err);
  }
}

function onRenderCharacterSheet(app, element) {
  try {
    if (app?.actor?.type !== "character") return;
    // Restore a visible Paper Doll button (self-guards on strategy + settings).
    injectDollHeaderButton(app, element);
    const tab = element?.querySelector?.(".sheet-inventory");
    // Dedupe: ApplicationV2 fires a render hook per class in the chain, and we
    // listen on three of them so the system's class name can change freely.
    if (!tab || tab.querySelector(".acks-equipment-wear")) return;
    regroup(app.actor, tab);
    // These controls attach to gear WHEREVER it renders — a torch stack and a
    // carried weapon stay in core's own lists, not a worn bucket — so each scans
    // the whole tab with its own per-row dedupe.
    injectLightControls(tab, app.actor); // Light a lantern/candle/torch-weapon (needs formation)
    injectTorchReady(tab, app.actor); // Ready a torch from a stack (formation-independent)
    injectDrawSheathe(tab, app.actor); // Draw / sheathe every weapon
    injectStrapControls(tab, app.actor); // Sling a shield (overlay-gated)
    // NOTE masterwork, the scavenged condition and a shield's VARIANT describe
    // what the item IS, not how it is being carried — they live on the item
    // sheet's ACKS Properties panel as inline controls (injectItemProperties).
  } catch (err) {
    console.error(`${MODULE_ID} | inventory regrouping failed; core's layout stands`, err);
  }
}

export function registerSheet() {
  // v13/v14 ApplicationV2 fires render hooks across the inheritance chain; the
  // base-class names fire regardless of the system sheet's class name, and the
  // handler dedupes, so multiple firings are harmless.
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
  Hooks.on("renderACKSCharacterSheetV2", onRenderCharacterSheet);
  // The ACKS Properties panel on an item's own sheet (masterwork, condition,
  // material, variant, helmet, spellbook, disguise). Guards on the document type.
  Hooks.on("renderApplicationV2", injectItemProperties);
  Hooks.on("renderItemSheetV2", injectItemProperties);
  console.debug(`${MODULE_ID} | inventory wear buckets + item property panel registered.`);
}
