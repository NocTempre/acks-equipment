/* global foundry, game, ui, fromUuid, Hooks */
/**
 * Container Manager — the missing controls for containers.mjs.
 *
 * The weight/capacity engine has always been complete; what was absent was any
 * way to *make* a container or *put something in one* short of hand-editing
 * `flags.acks-equipment.containedIn`. This app supplies both:
 *
 *   - drag an item from the loose list (or straight off the character sheet)
 *     onto a container to stow it; drag it back out, or use the eject control;
 *   - "Annotate carrying gear" stamps RAW capacities onto core's own backpacks,
 *     sacks, quivers, and the adventurer's harness (RR pp. 142–145) in place;
 *   - any item can be turned into a container with an explicit capacity, for
 *     gear core doesn't ship.
 *
 * Nothing here invents storage semantics: contents stay REAL items on the actor
 * (see containers.mjs), so core's encumbrance keeps counting them exactly once.
 */
import { MODULE_ID } from "../constants.mjs";
import {
  STONE,
  containerReport,
  looseItems,
  storeIn,
  takeOut,
  emptyContainer,
  isContainer,
  encumbranceDelta6,
} from "../containers.mjs";
import { annotateItem } from "../api.mjs";
import { containerProfileFor } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Stone display: two decimals, trailing zeroes trimmed. */
function st(weight6) {
  return String(Number(weight6 / STONE).toFixed(2)).replace(/\.?0+$/, "") || "0";
}

export default class ContainerManager extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Bound re-render listener, live only while the window is open. */
  #refresh = null;

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["acks-equipment", "acks-equipment-containers"],
    window: { title: "ACKS-EQUIPMENT.container.title", icon: "fas fa-box-open", resizable: true },
    position: { width: 540, height: 660 },
    actions: {
      takeOut: ContainerManager.#onTakeOut,
      emptyContainer: ContainerManager.#onEmpty,
      makeContainer: ContainerManager.#onMakeContainer,
      unmakeContainer: ContainerManager.#onUnmakeContainer,
      annotateGear: ContainerManager.#onAnnotateGear,
      openItem: ContainerManager.#onOpenItem,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/container-manager.hbs`,
      scrollable: [".acks-equipment-container-scroll"],
    },
  };

  /** @override */
  get title() {
    return `${game.i18n.localize("ACKS-EQUIPMENT.container.title")} — ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext() {
    const actor = this.actor;
    const line = (i) => ({
      id: i.id,
      uuid: i.uuid,
      name: i.name,
      img: i.img,
      weight: st(Number(i.system?.weight6 ?? 0)),
      isContainer: isContainer(i),
      equipped: !!i.system?.equipped,
      // Only offer "make a container" for gear that is not one already.
      suggestible: !isContainer(i) && !!containerProfileFor(i.name),
    });

    const containers = containerReport(actor).map((c) => ({
      ...line(c.item),
      capacityStone: c.capacityStone,
      loadStone: st(c.load6),
      over: c.over,
      pct: c.capacityStone ? Math.min(100, (c.load6 / (c.capacityStone * STONE)) * 100) : 0,
      label: c.capacityStone ? `${st(c.load6)} / ${c.capacityStone} st` : `${st(c.load6)} st`,
      contents: c.contents.map(line),
    }));

    const delta6 = encumbranceDelta6(actor);
    return {
      actorName: actor.name,
      containers,
      hasContainers: containers.length > 0,
      loose: looseItems(actor).filter((i) => !isContainer(i)).map(line),
      encumbrance: {
        value: actor.system?.encumbrance?.value ?? "?",
        max: actor.system?.encumbrance?.max ?? "?",
      },
      // Surface the RAW corrections so the number on the sheet is explicable.
      correction: delta6
        ? game.i18n.format("ACKS-EQUIPMENT.container.correction", {
            stone: st(Math.abs(delta6)),
            direction: game.i18n.localize(
              delta6 < 0 ? "ACKS-EQUIPMENT.container.ignored" : "ACKS-EQUIPMENT.container.added",
            ),
          })
        : null,
      isOwner: actor.isOwner,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Drag & drop                                                        */
  /* ------------------------------------------------------------------ */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.actor.isOwner) return;
    const root = this.element;

    for (const row of root.querySelectorAll("[data-item-id][draggable='true']")) {
      row.addEventListener("dragstart", this.#onDragStart.bind(this));
    }
    for (const zone of root.querySelectorAll("[data-drop-target]")) {
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        zone.classList.add("drop-hover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop-hover"));
      zone.addEventListener("drop", (ev) => {
        zone.classList.remove("drop-hover");
        this.#onDrop(ev, zone).catch((err) => console.error(`${MODULE_ID} | container drop failed`, err));
      });
    }
  }

  /** Emit the standard Foundry Item drag payload so core sheets understand it. */
  #onDragStart(event) {
    const id = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
    event.dataTransfer.effectAllowed = "move";
  }

  /**
   * Accepts drops from this app AND from the core character sheet (both emit
   * the standard `{type:"Item", uuid}` payload), so gear can be dragged
   * straight out of the inventory tab into a pack.
   */
  async #onDrop(event, zone) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return; // not a Foundry drag payload
    }
    if (data?.type !== "Item" || !data.uuid) return;

    const item = await fromUuid(data.uuid);
    // Only this actor's own embedded items can be stowed — a drop from a
    // compendium or another actor is a copy operation we deliberately don't do.
    if (!item || item.parent?.id !== this.actor.id) {
      ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.container.foreignItem"));
      return;
    }

    const targetId = zone.dataset.dropTarget;
    const moved = targetId === "loose"
      ? await takeOut(item)
      : await storeIn(this.actor, item, this.actor.items.get(targetId));
    if (moved) this.render();
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  static async #onTakeOut(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (item && (await takeOut(item))) this.render();
  }

  static async #onEmpty(event, target) {
    const container = this.actor.items.get(target.dataset.itemId);
    if (!container) return;
    const n = await emptyContainer(this.actor, container);
    if (n) {
      ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.emptied", { n, name: container.name }));
      this.render();
    }
  }

  /** Annotate every carrying device on the actor from the RAW profile table. */
  static async #onAnnotateGear() {
    let n = 0;
    for (const item of this.actor.items) {
      if (item.type !== "item" || isContainer(item)) continue;
      if (await annotateItem(item)) n++;
    }
    ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.annotated", { n }));
    this.render();
  }

  /** Turn an arbitrary item into a container with an explicit RAW capacity. */
  static async #onMakeContainer(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    const suggested = containerProfileFor(item.name)?.capacity ?? 1;
    const capacity = await DialogV2.prompt({
      window: { title: game.i18n.format("ACKS-EQUIPMENT.container.makeTitle", { name: item.name }) },
      content: `<p>${game.i18n.localize("ACKS-EQUIPMENT.container.capacityPrompt")}</p>
        <input type="number" name="capacity" value="${suggested}" step="0.5" min="0" autofocus>`,
      ok: {
        label: game.i18n.localize("ACKS-EQUIPMENT.container.makeConfirm"),
        callback: (ev, button) => Number(button.form.elements.capacity.value),
      },
      rejectClose: false,
    });
    if (capacity === null || capacity === undefined || Number.isNaN(capacity)) return;
    await item.setFlag(MODULE_ID, "container", { capacity });
    this.render();
  }

  /** Stop treating an item as a container; its contents spill out loose. */
  static async #onUnmakeContainer(event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    await emptyContainer(this.actor, item);
    await item.unsetFlag(MODULE_ID, "container");
    this.render();
  }

  static async #onOpenItem(event, target) {
    this.actor.items.get(target.dataset.itemId)?.sheet?.render(true);
  }

  /* ------------------------------------------------------------------ */
  /*  Live refresh                                                       */
  /* ------------------------------------------------------------------ */

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Keep in step with edits made anywhere else (sheet, macro, another client).
    this.#refresh = (doc) => {
      const actorId = doc?.parent?.id ?? doc?.id;
      if (actorId === this.actor.id) this.render();
    };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, this.#refresh);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (this.#refresh) {
      for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.off(hook, this.#refresh);
      this.#refresh = null;
    }
  }
}

/** Open the manager for an actor, reusing an existing window. */
export function openContainerManager(actor) {
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.container.noActor"));
    return null;
  }
  const id = `${MODULE_ID}-containers-${actor.id}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    existing.render(true);
    existing.bringToFront?.();
    return existing;
  }
  const app = new ContainerManager(actor, { id });
  app.render(true);
  return app;
}
