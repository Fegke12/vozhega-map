"use strict";

const RedBook = (() => {
  const dialog = document.querySelector("#redbook-dialog");
  const find = (selector) => dialog.querySelector(selector);
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let callbacks;
  let index = 0;
  let placeId = "orchids";
  let opened = false;
  let opening = false;
  let turning = false;
  let openingTimer;
  let finishTimer;
  let turnTimer;

  function currentPlant() {
    return RED_BOOK_PLANTS[index];
  }
  function currentPlace() {
    return PLANT_PLACES.find((place) => place.id === placeId);
  }
  function renderPage() {
    const plant = currentPlant();
    if (!plant.places.includes(placeId)) placeId = plant.places[0];
    find("#book-photo").src = plant.image;
    find("#book-photo").alt = plant.name;
    find("#book-photo").style.objectPosition = plant.imagePosition;
    find("#book-plant-title").textContent = plant.name;
    find("#book-description").textContent = plant.description;
    find("#book-place-name").textContent = currentPlace().name;
    find("#book-page-number").textContent = String(index + 1).padStart(2, "0");
    find("#book-folio").textContent = String(index * 2 + 2).padStart(2, "0");
    find(".book-copy").scrollTop = 0;
    find("#book-prev").setAttribute("aria-disabled", String(!opened || turning || index === 0));
    find("#book-next").setAttribute("aria-disabled", String(!opened || turning || index === RED_BOOK_PLANTS.length - 1));
    dialog.querySelectorAll("[data-book-index]").forEach((button) => {
      button.setAttribute("aria-current", Number(button.dataset.bookIndex) === index ? "page" : "false");
      button.setAttribute("aria-disabled", String(!opened || turning));
    });
  }
  function clearTimers() {
    clearTimeout(openingTimer);
    clearTimeout(finishTimer);
    clearTimeout(turnTimer);
  }
  function reveal() {
    if (!dialog.open || opened || opening) return;
    opening = true;
    find("#book-volume").classList.add("is-open");
    find("#book-cover").setAttribute("aria-hidden", "true");
    find("#book-cover").tabIndex = -1;
    finishTimer = setTimeout(() => {
      if (!dialog.open) return;
      opened = true;
      opening = false;
      find("#book-spread").inert = false;
      find("#book-spread").setAttribute("aria-hidden", "false");
      renderPage();
      find("#book-plant-title").focus({ preventScroll: true });
      callbacks.onExplore();
    }, motion ? 850 : 0);
  }
  function open(plantId = "calceolus", locationId, launcher) {
    const found = RED_BOOK_PLANTS.findIndex((plant) => plant.id === plantId);
    if (found < 0) return;
    clearTimers();
    index = found;
    placeId = locationId || currentPlant().places[0];
    opened = false;
    opening = false;
    turning = false;
    find("#book-volume").classList.remove("is-open", "turn-forward", "turn-back");
    find("#book-cover").removeAttribute("aria-hidden");
    find("#book-cover").tabIndex = 0;
    find("#book-spread").inert = true;
    find("#book-spread").setAttribute("aria-hidden", "true");
    renderPage();
    callbacks.showDialog(dialog, launcher);
    openingTimer = setTimeout(reveal, motion ? 140 : 0);
  }
  function goTo(nextIndex) {
    if (!opened || turning || nextIndex === index || nextIndex < 0 || nextIndex >= RED_BOOK_PLANTS.length) return;
    const direction = nextIndex > index ? "turn-forward" : "turn-back";
    turning = true;
    renderPage();
    find("#book-volume").classList.add(direction);
    turnTimer = setTimeout(() => {
      if (!dialog.open) return;
      index = nextIndex;
      renderPage();
    }, motion ? 230 : 0);
    finishTimer = setTimeout(() => {
      turning = false;
      find("#book-volume").classList.remove(direction);
      if (dialog.open) renderPage();
    }, motion ? 650 : 0);
  }
  function init(options) {
    callbacks = options;
    document.querySelector("#bio-plant-list").innerHTML = RED_BOOK_PLANTS.map((plant, i) =>
      `<button class="bio-plant-row" data-bio-plant="${plant.id}"><img src="${plant.image}" alt="" width="46" height="58"><span><small>0${i + 1}</small><strong>${plant.name}</strong></span><b aria-hidden="true">→</b></button>`,
    ).join("");
    find("#book-dots").innerHTML = RED_BOOK_PLANTS.map((plant, i) =>
      `<button data-book-index="${i}" aria-label="Страница ${i + 1}: ${plant.name}" aria-current="false"></button>`,
    ).join("");
    if (typeof Image === "function") RED_BOOK_PLANTS.forEach((plant) => {
      const image = new Image();
      image.src = plant.image;
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.bioPlant) {
        callbacks.enterMap();
        open(button.dataset.bioPlant, undefined, button);
      } else if (button.dataset.bookIndex !== undefined) {
        goTo(Number(button.dataset.bookIndex));
      } else if (button.dataset.action === "redbook") {
        callbacks.enterMap();
        open("calceolus", undefined, button);
      } else if (button.dataset.action === "book-open") {
        reveal();
      } else if (button.dataset.action === "book-prev") {
        goTo(index - 1);
      } else if (button.dataset.action === "book-next") {
        goTo(index + 1);
      } else if (button.dataset.action === "book-map") {
        callbacks.closeDialog(dialog);
        callbacks.showPlace(placeId);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (!opened) reveal();
        else goTo(index + (event.key === "ArrowRight" ? 1 : -1));
      }
    });
    dialog.addEventListener("close", () => {
      clearTimers();
      opened = false;
      opening = false;
      turning = false;
    });
  }
  return { dialog, init, open, goTo, currentPlant, currentPlace };
})();
