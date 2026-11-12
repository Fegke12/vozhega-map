"use strict";
const $ = (selector) => document.querySelector(selector);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const chapterDialog = $("#chapter-dialog");
const infoDialog = $("#info-dialog");
const photoDialog = $("#photo-dialog");
const stageNames = ["Место", "Исследование", "Наблюдение"];
const progress = {};
const session = {};
let currentIndex = 0;
let currentStep = 0;
let showMode = false;
let map;
let toastTimer;
let lastLauncher;
let storageWarning = false;
const markers = new Map();
const LAKES = [
  {
    name: "Озеро Воже",
    image: "assets/media/lake-vozhe.webp",
    caption: "Заросли тростника обыкновенного. Вологодская область.",
    author: "Александра С. Комарова",
    year: 2018,
  },
  {
    name: "Озеро Святое",
    image: "assets/media/lake-svyatoe.webp",
    caption:
      "Озеро с лесистым водосбором. Вологодская область. Район съёмки в подписи источника не указан.",
    author: "Дмитрий А. Филиппов",
    year: 2019,
  },
  {
    name: "Озеро Долгое",
    image: "assets/media/lake-dolgoe.webp",
    caption:
      "Озеро речного типа. Вологодская область. Район съёмки в подписи источника не указан.",
    author: "Дмитрий А. Филиппов",
    year: 2018,
  },
];
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function loadProgress() {
  const legacy = readJson("vozhega-expedition-v1", []);
  STOPS.forEach((stop) => {
    const saved = readJson(`vozhega-v2-${stop.id}`, {});
    progress[stop.id] = {
      done:
        saved.done === true ||
        (saved.done === undefined &&
          Array.isArray(legacy) &&
          legacy.includes(stop.id)),
      notes: typeof saved.notes === "string" ? saved.notes.slice(0, 1000) : "",
    };
    session[stop.id] = {
      karstStep: 0,
      concentration: 1,
      evaporated: false,
      plant: 0,
      depth: 0,
      absolute: false,
      answer: null,
    };
  });
}
function persist(id) {
  try {
    localStorage.setItem(`vozhega-v2-${id}`, JSON.stringify(progress[id]));
  } catch {
    if (!storageWarning)
      toast(
        "Браузер ограничил сохранение. Дневник доступен до закрытия страницы.",
      );
    storageWarning = true;
  }
}
function completedCount() {
  return STOPS.filter((stop) => progress[stop.id].done).length;
}
function renderRoute() {
  $("#stop-list").innerHTML = STOPS.map(
    (stop) =>
      `<button class="stop-row ${progress[stop.id].done ? "visited" : ""}" data-stop="${stop.id}" aria-label="${stop.number}. ${stop.place}. ${stop.subject}"><span class="stop-number">${progress[stop.id].done ? "✓" : stop.number}</span><span class="stop-copy"><strong>${stop.place}</strong><small>${stop.short}</small></span><span class="row-arrow">→</span></button>`,
  ).join("");
  const count = completedCount();
  $("#notebook-count").textContent = `${count}/4`;
  $("#progress-label").textContent = `${count} ИЗ 4`;
  $("#progress-fill").style.width = `${count * 25}%`;
  $("#start-button").innerHTML =
    `${count === 4 ? "Развернуть дневник" : count ? "Продолжить экспедицию" : "Начать экспедицию"} <span>→</span>`;
  markers.forEach((marker, id) =>
    marker.setIcon(makeIcon(STOPS.find((stop) => stop.id === id))),
  );
}
function markComplete() {
  const stop = STOPS[currentIndex];
  if (progress[stop.id].done) return;
  progress[stop.id].done = true;
  persist(stop.id);
  renderRoute();
  $("#chapter-progress").textContent = "✓ Открытие записано в дневник";
  toast(
    completedCount() === 4
      ? "Все четыре открытия собраны. Разверни дневник!"
      : "Новая страница полевого дневника готова",
  );
}
function sourceLink(id) {
  const source = SOURCES.find((item) => item.id === id);
  return `<a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title} →</a>`;
}
function mapOverviewOptions() {
  const mobile = matchMedia("(max-width: 650px)").matches;
  return {
    paddingTopLeft: mobile ? [35, 80] : [90, 90],
    paddingBottomRight: mobile ? [140, 160] : [210, 270],
    maxZoom: 10,
  };
}
function overview() {
  if (map)
    map.flyToBounds(
      STOPS.filter((stop) => stop.coords).map((stop) => stop.coords),
      { ...mapOverviewOptions(), duration: reduceMotion ? 0 : 1 },
    );
}
function makeIcon(stop) {
  return L.divIcon({
    className: "pin",
    html: `<div class="pin-button ${progress[stop.id].done ? "pin-complete" : ""}"><span>${progress[stop.id].done ? "✓" : stop.number}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
  });
}
function setupMap() {
  if (!window.L) {
    $("#map-status").hidden = false;
    return;
  }
  map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: false,
    minZoom: 6,
    maxZoom: 15,
  }).setView([60.53, 40.04], 9);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  let loadedTiles = 0;
  const tileTimeout = setTimeout(() => {
    if (!loadedTiles) $("#map-status").hidden = false;
  }, 10000);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  })
    .addTo(map)
    .on("tileload", () => {
      loadedTiles++;
      clearTimeout(tileTimeout);
      $("#map-status").hidden = true;
    });
  STOPS.filter((stop) => stop.coords).forEach((stop) => {
    const marker = L.marker(stop.coords, {
      icon: makeIcon(stop),
      title: `${stop.number}. ${stop.place}`,
      alt: `Открыть ${stop.place}`,
      keyboard: true,
    })
      .addTo(map)
      .bindTooltip(stop.place, {
        permanent: true,
        direction: "right",
        offset: [18, -22],
        className: "map-label",
      });
    marker.on("click", () => openChapter(stop.id, marker.getElement()));
    markers.set(stop.id, marker);
  });
  L.circleMarker([60.472, 40.214], {
    radius: 5,
    color: "#fff8e9",
    weight: 2,
    fillColor: "#43634d",
    fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip("Вожега", {
      permanent: true,
      direction: "bottom",
      className: "town-label",
    });
  map.fitBounds(
    STOPS.filter((stop) => stop.coords).map((stop) => stop.coords),
    mapOverviewOptions(),
  );
}
function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function openChapter(id, launcher) {
  const index = STOPS.findIndex((stop) => stop.id === id);
  if (index < 0) return;
  if (launcher) lastLauncher = launcher;
  if (infoDialog.open) infoDialog.close();
  currentIndex = index;
  currentStep = 0;
  renderChapter();
  showDialog(chapterDialog);
  const stop = STOPS[index];
  if (map && stop.coords)
    map.flyTo(stop.coords, 11, { duration: reduceMotion ? 0 : 1.1 });
}
function renderChapter() {
  const stop = STOPS[currentIndex];
  $("#chapter-kicker").textContent = stop.kicker;
  $("#chapter-subject").textContent = stop.subject;
  $("#chapter-subject").style.setProperty("--subject", stop.color);
  $("#chapter-title").textContent = stop.title;
  $("#chapter-place").textContent = stop.place;
  chapterDialog.style.setProperty("--subject", stop.color);
  document.querySelectorAll("[data-step]").forEach((button) => {
    const selected = Number(button.dataset.step) === currentStep;
    button.setAttribute("aria-current", selected ? "step" : "false");
  });
  $("#chapter-visual").innerHTML = visualMarkup(stop);
  $("#chapter-body").innerHTML =
    currentStep === 0
      ? placeMarkup(stop)
      : currentStep === 1
        ? experimentMarkup(stop)
        : observationMarkup(stop);
  $("#chapter-progress").textContent = progress[stop.id].done
    ? "✓ Открытие записано"
    : `${stop.number}/04 · ${stageNames[currentStep]}`;
  $("#next-button").innerHTML =
    `${currentStep === 0 ? "К исследованию" : currentStep === 1 ? "Моё наблюдение" : currentIndex === 3 ? "Развернуть дневник" : "Следующее место"} <span>→</span>`;
  $(".chapter-copy").scrollTop = 0;
  chapterDialog.scrollTop = 0;
  updateVisual();
}
function placeMarkup(stop) {
  return `<p class="chapter-lead">${stop.lead}</p><p class="body-copy">${stop.body}</p><div class="fact-grid">${stop.facts.map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join("")}</div><div class="location-note"><span>⌖ ${stop.location}</span><p>${stop.locationNote}</p></div><div class="chapter-sources">${stop.sources.map(sourceLink).join("")}</div>`;
}
function visualMarkup(stop) {
  if (stop.id === "biology") {
    const plant = PLANTS[session.biology.plant];
    return `<div class="visual-label">ПОЛЕВОЙ АТЛАС · ФОТОГРАФИЯ ВИДА</div><button class="plant-photo" data-action="enlarge-plant" aria-label="Увеличить фотографию орхидеи"><img id="plant-photo" src="${plant.image}" alt="${plant.name}" width="1067" height="1600"><span>Рассмотреть цветок ⊕</span></button><div class="visual-caption"><span id="plant-caption">${plant.caption}</span><small id="plant-credit">Фото ${plant.author} · ${plant.license}</small></div>`;
  }
  const drawing = {
    karst: karstSvg,
    chemistry: chemistrySvg,
    physics: lakeSvg,
  }[stop.id]();
  return `<div class="visual-label">${stop.id === "karst" ? "ЧТО ПРОИСХОДИТ ПОД ЗЕМЛЁЙ" : stop.id === "chemistry" ? "МОДЕЛЬНЫЙ ОБРАЗЕЦ · 1 ЛИТР" : "ИССЛЕДОВАТЕЛЬСКИЙ ЗОНД"}</div><div class="drawing">${drawing}</div><div class="visual-stat" id="visual-stat"></div><div class="visual-caption">${stop.id === "physics" ? "Профиль дна условный. Глубина — по опубликованной съёмке." : stop.id === "chemistry" ? "Количество ионов и их размеры показаны условно. Модельный состав задаёт посетитель." : "Условная схема одного из механизмов образования карстового озера."}</div>`;
}
function experimentMarkup(stop) {
  const model = session[stop.id];
  if (stop.id === "karst") {
    return `<p class="chapter-lead">Вода работает медленно.<br>Последствия бывают большими.</p><div class="step-controls" aria-label="Этапы карстового процесса">${["Вода", "Полость", "Озеро"].map((label, index) => `<button data-karst="${index}" class="${model.karstStep === index ? "selected" : ""}"><small>0${index + 1}</small>${label}</button>`).join("")}</div><div class="result-card" id="karst-result"></div><p class="body-copy small-copy">Переключай этапы. Эта схема объясняет процесс и не воспроизводит геологическое строение конкретного местного озера.</p><button class="secondary" data-action="advance-karst">Следующий этап →</button>`;
  }
  if (stop.id === "chemistry") {
    return `<p class="chapter-lead">Измени состав.<br>Сравни результат.</p><label class="range-label" for="concentration">Солей в модельном образце <output id="concentration-value">${model.concentration.toFixed(1).replace(".", ",")} г/л</output></label><input id="concentration" type="range" min="0" max="35" step="0.5" value="${model.concentration}"><div class="range-ends"><span>0 г/л</span><span>35 г/л</span></div><div class="result-card"><small>В ОДНОМ ЛИТРЕ ОБРАЗЦА</small><strong id="sample-mass"></strong><p id="sample-text"></p></div><button class="secondary" data-action="evaporate">${model.evaporated ? "Восстановить образец" : "Испарить воду в модели"} →</button><p class="body-copy small-copy">В идеализированном опыте вода испаряется, растворённые нелетучие соли остаются. Числа выбираешь ты — это учебная модель.</p><details class="evidence-note"><summary>А что известно о самом озере?</summary><p>Солёность этого конкретного водоёма пока требует подтверждения. В отчёте ВНИРО описано озеро Погорелово с низкой минерализацией. Его тождество Погореловскому в реестре требует сверки.</p>${sourceLink("water")}</details>`;
  }
  if (stop.id === "biology") {
    const plant = PLANTS[model.plant];
    return `<p class="chapter-lead">Три страницы<br>лесного атласа.</p><div class="plant-tabs" aria-label="Выбрать вид орхидеи">${PLANTS.map((item, index) => `<button data-plant="${index}" aria-pressed="${model.plant === index}" class="${model.plant === index ? "selected" : ""}">${index + 1}<span>${item.name}</span></button>`).join("")}</div><h3 id="plant-name">${plant.name}</h3><p class="latin" id="plant-latin">${plant.latin}</p><div class="result-card"><small id="plant-feature">${plant.feature}</small><p id="plant-description">${plant.text}</p></div><p class="body-copy small-copy">Фотографии показывают виды растений. Их съёмка внутри урочища не подтверждена. Нажми на снимок для увеличения.</p>`;
  }
  return `<p class="chapter-lead">Опусти зонд.<br>Посчитай давление.</p><label class="range-label" for="depth">Глубина <output id="depth-value"></output></label><input id="depth" type="range" min="0" max="13.8" step="0.1" value="${model.depth}"><div class="range-ends"><span>Поверхность</span><span>13,8 м</span></div><div class="pressure-tabs"><button data-pressure="water" class="${!model.absolute ? "selected" : ""}" aria-pressed="${!model.absolute}">Столб воды</button><button data-pressure="absolute" class="${model.absolute ? "selected" : ""}" aria-pressed="${model.absolute}">Полное давление</button></div><div class="result-card pressure-result"><small id="pressure-label"></small><strong id="pressure-value"></strong><p id="pressure-formula"></p></div><p class="body-copy small-copy">В модели ρ = 1000 кг/м³, g = 9,81 м/с². Для полного давления принято p₀ = 101,3 кПа. Температура и плотность воды условно постоянны.</p>`;
}
function observationMarkup(stop) {
  const answered = session[stop.id].answer;
  return `<p class="chapter-lead">Что ты заметил?</p><p class="observation-question">${stop.task}</p><div class="answers">${stop.answers.map((answer, index) => `<button data-answer="${index}" class="${answered === index ? (index === stop.correct ? "correct" : "incorrect") : ""}"><span>${String.fromCharCode(65 + index)}</span>${answer}</button>`).join("")}</div><div id="answer-feedback" role="status" class="result-card ${answered === null ? "" : "feedback-visible"}" ${answered === null ? "hidden" : ""}>${answered === stop.correct ? "<small>НАБЛЮДЕНИЕ ЗАПИСАНО</small>" : "<small>ПОПРОБУЙ ЕЩЁ РАЗ</small>"}<p>${answered === stop.correct ? stop.explanation : "Вернись к опыту и сравни наблюдение с предложенными ответами."}</p></div><p class="body-copy small-copy">После верного наблюдения в дневнике появится вывод. Остановки можно исследовать в любом порядке.</p>`;
}
function updateVisual() {
  const stop = STOPS[currentIndex];
  const model = session[stop.id];
  if (stop.id === "karst") {
    $("#cavity").setAttribute("opacity", model.karstStep >= 1 ? "1" : "0");
    $("#karst-lake").setAttribute("opacity", model.karstStep === 2 ? "1" : "0");
    const texts = [
      "Вода проникает в трещины и постепенно растворяет подходящие породы.",
      "Трещины расширяются. Под поверхностью образуется полость.",
      "Поверхность может просесть или обрушиться. В углублении может накопиться вода.",
    ];
    $("#visual-stat").innerHTML =
      `<span>ЭТАП 0${model.karstStep + 1}</span><strong>${["Проникновение", "Растворение", "Заполнение"][model.karstStep]}</strong>`;
    if ($("#karst-result"))
      $("#karst-result").innerHTML =
        `<small>ЭТАП ${model.karstStep + 1} ИЗ 3</small><p>${texts[model.karstStep]}</p>`;
  }
  if (stop.id === "chemistry") {
    $("#salt-particles").setAttribute(
      "opacity",
      String(Math.min(model.concentration / 10, 1)),
    );
    $("#salt-particles").setAttribute(
      "transform",
      model.evaporated ? "translate(-100,175) scale(1.6,.2)" : "",
    );
    $(".bubbles").style.opacity = model.evaporated ? "0" : "1";
    const water = $(".drawing svg [clip-path] > path");
    const y = model.evaporated ? 205 : 92;
    water.setAttribute(
      "d",
      `M106 ${y}Q130 ${y - 10} 158 ${y + 1}T215 ${y}V229H106Z`,
    );
    $("#visual-stat").innerHTML =
      `<span>${model.evaporated ? "ОСТАТОК ПОСЛЕ ИСПАРЕНИЯ" : "УЧЕБНАЯ КОНЦЕНТРАЦИЯ"}</span><strong>${model.concentration.toFixed(1).replace(".", ",")} ${model.evaporated ? "г" : "г/л"}</strong>`;
    if ($("#concentration-value"))
      $("#concentration-value").textContent =
        `${model.concentration.toFixed(1).replace(".", ",")} г/л`;
    if ($("#sample-mass"))
      $("#sample-mass").textContent =
        `${model.concentration.toFixed(1).replace(".", ",")} г солей`;
    if ($("#sample-text"))
      $("#sample-text").textContent = model.evaporated
        ? "Вода испарилась. В этой упрощённой модели масса нелетучих солей сохранилась."
        : "После полного испарения литра такого модельного образца останется столько нелетучих солей.";
  }
  if (stop.id === "physics") {
    const pressure = model.depth * 9.81 + (model.absolute ? 101.3 : 0);
    $("#dive-marker").setAttribute(
      "transform",
      `translate(144,${51 + (model.depth / 13.8) * 126})`,
    );
    $("#visual-stat").innerHTML =
      `<span>ЗОНД ПОД ПОВЕРХНОСТЬЮ</span><strong>${model.depth.toFixed(1).replace(".", ",")} м</strong>`;
    if ($("#depth-value"))
      $("#depth-value").textContent =
        `${model.depth.toFixed(1).replace(".", ",")} м`;
    if ($("#pressure-value"))
      $("#pressure-value").textContent =
        `${pressure.toFixed(1).replace(".", ",")} кПа`;
    if ($("#pressure-label"))
      $("#pressure-label").textContent = model.absolute
        ? "ПОЛНОЕ ДАВЛЕНИЕ"
        : "ДАВЛЕНИЕ СТОЛБА ВОДЫ";
    if ($("#pressure-formula"))
      $("#pressure-formula").textContent = model.absolute
        ? "p = p₀ + ρgh. Учитываем давление над поверхностью."
        : "p = ρgh. Каждые 5 метров добавляют около 49 кПа.";
  }
}
function changePlant(index) {
  session.biology.plant = index;
  const plant = PLANTS[index];
  $("#plant-photo").src = plant.image;
  $("#plant-photo").alt = plant.name;
  $("#plant-caption").textContent = plant.caption;
  $("#plant-credit").textContent = `Фото ${plant.author} · ${plant.license}`;
  $("#plant-name").textContent = plant.name;
  $("#plant-latin").textContent = plant.latin;
  $("#plant-feature").textContent = plant.feature;
  $("#plant-description").textContent = plant.text;
  document.querySelectorAll("[data-plant]").forEach((button) => {
    const selected = Number(button.dataset.plant) === index;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
function nextStage() {
  if (currentStep < 2) currentStep++;
  else if (currentIndex < 3) {
    currentIndex++;
    currentStep = 0;
    flyToCurrent();
  } else {
    openNotebook();
    return;
  }
  renderChapter();
}
function previousStage() {
  if (currentStep > 0) currentStep--;
  else if (currentIndex > 0) {
    currentIndex--;
    currentStep = 2;
    flyToCurrent();
  } else {
    chapterDialog.close();
    return;
  }
  renderChapter();
}
function flyToCurrent() {
  const stop = STOPS[currentIndex];
  if (map && stop.coords)
    map.flyTo(stop.coords, 11, { duration: reduceMotion ? 0 : 1 });
}
function setShowMode(value) {
  showMode = value;
  document.body.classList.toggle("presentation", value);
  $(".show-shortcuts").hidden = !value;
  $('[data-action="toggle-show"]').setAttribute("aria-pressed", String(value));
}
function openInfo(html, launcher) {
  if (launcher) lastLauncher = launcher;
  if (chapterDialog.open) chapterDialog.close();
  $("#info-content").innerHTML = html;
  showDialog(infoDialog);
}
function openNotebook(launcher) {
  const count = completedCount();
  openInfo(
    `<div class="eyebrow">ЛИЧНЫЙ ПОЛЕВОЙ ДНЕВНИК · ${count}/4</div><h2 id="info-title">${count === 4 ? "Четыре открытия рядом." : "Каждое место — открытие."}</h2><p class="body-copy">${count === 4 ? "Ты увидел, как связаны рельеф, состав воды, растения и физические законы." : "Проходи опыты и записывай наблюдения. Дневник сохраняется в этом браузере."}</p><div class="notebook-grid">${STOPS.map((stop) => `<article class="notebook-entry ${progress[stop.id].done ? "done" : ""}"><div class="notebook-entry-head"><span class="stop-number">${progress[stop.id].done ? "✓" : stop.number}</span><button data-stop="${stop.id}"><small>${stop.subject}</small><strong>${stop.place} →</strong></button></div><p>${progress[stop.id].done ? stop.takeaway : "Эта страница ждёт твоего наблюдения."}</p><label for="note-${stop.id}">Моя заметка</label><textarea id="note-${stop.id}" data-note="${stop.id}" maxlength="1000" rows="2" placeholder="Что запомнилось?"></textarea></article>`).join("")}</div><div class="info-actions"><button class="primary" data-action="back-map">Развернуть карту <span>→</span></button><button class="secondary" data-action="share">QR-код экскурсии</button></div>`,
    launcher,
  );
  STOPS.forEach((stop) => {
    $(`#note-${stop.id}`).value = progress[stop.id].notes;
  });
}
function openSources(launcher) {
  openInfo(
    `<div class="eyebrow">ИСТОЧНИКИ И АВТОРЫ</div><h2 id="info-title">У каждого открытия<br>есть основание.</h2><p class="body-copy">Материалы сверены 12 ноября 2026 года. Учебные модели отделены от измерений конкретных водоёмов. Геометка урочища показывает научный сбор, а не его границы.</p><div class="source-list">${SOURCES.map((source) => `<article><small>${source.publisher}</small><h3><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title} →</a></h3><p>${source.note}</p></article>`).join("")}</div><h3>Фотографии растений</h3><div class="credit-grid">${PLANTS.map((plant) => `<article><img src="${plant.image}" alt="${plant.name}" loading="lazy" width="100" height="125"><div><strong>${plant.name}</strong><p>${plant.author} · <a href="${plant.licenseUrl}" target="_blank" rel="noopener">${plant.license}</a></p><p>${plant.caption} Уменьшение и WebP-конвертация, композиция и цвет сохранены.</p><a href="${plant.source}" target="_blank" rel="noopener">Оригинал →</a></div></article>`).join("")}</div><h3>Фотографии озёр</h3><p class="body-copy">Philippov et al., Biodiversity Data Journal 10:e77626 (2022), DOI 10.3897/BDJ.10.e77626. Источник изображений — NLM/PMC. CC BY 4.0. Выполнена WebP-конвертация.</p>${LAKES.map((lake) => `<p class="credit-line"><strong>${lake.name}</strong> — ${lake.author}, ${lake.year}. ${lake.caption}</p>`).join("")}<p class="body-copy">Общая статья и сведения о лицензии приведены выше. Лицензия фотографий озёр — <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>`,
    launcher,
  );
}
function openShare(launcher) {
  openInfo(
    `<div class="eyebrow">ЭКСПЕДИЦИЯ НА ТВОЁМ ТЕЛЕФОНЕ</div><h2 id="info-title">Забери карту с собой.</h2><img class="qr-image" src="assets/vozhega-qr.svg" alt="QR-код ссылки на экскурсию" width="260" height="260"><p class="body-copy">Наведи камеру телефона на код, чтобы открыть экскурсию. Доступ к опубликованной странице определяется настройками сайта и может потребовать входа в ChatGPT.</p><a class="primary download-link" href="assets/vozhega-qr.png" download="Pognali_v_Vozhegu_QR.png">Скачать QR-код <span>↓</span></a><a class="plain-link" href="${SITE_URL}" target="_blank" rel="noopener">Открыть ссылку на экскурсию →</a>`,
    launcher,
  );
}
function openGallery(launcher) {
  openInfo(
    `<div class="eyebrow">ФОТОДНЕВНИК · ВОЛОГОДСКАЯ ОБЛАСТЬ</div><h2 id="info-title">У воды свой характер.</h2><p class="body-copy">Три настоящих кадра из научной публикации об озёрах Вологодской области.</p><div class="lake-gallery">${LAKES.map((lake) => `<figure><img src="${lake.image}" alt="${lake.name}" width="800" height="600" loading="lazy"><figcaption><strong>${lake.name}</strong><p>${lake.caption}</p><small>Фото ${lake.author}, ${lake.year} · CC BY 4.0</small></figcaption></figure>`).join("")}</div><p class="body-copy">Фотографии иллюстрируют озёра региона. Снимков именно Пертозера и Погореловского с подтверждённой свободной лицензией пока нет.</p><button class="text-button" data-action="sources">Авторство и источники →</button>`,
    launcher,
  );
}
function closeDialog(dialog) {
  dialog.close();
  if (lastLauncher && document.contains(lastLauncher))
    lastLauncher.focus({ preventScroll: true });
}
const actions = {
  start: (button) => {
    if (completedCount() === 4) openNotebook(button);
    else openChapter(STOPS.find((stop) => !progress[stop.id].done).id, button);
  },
  notebook: openNotebook,
  sources: openSources,
  share: openShare,
  overview,
  "region-gallery": openGallery,
  "map-help": (button) =>
    openInfo(
      `<div class="eyebrow">ЛЕГЕНДА КАРТЫ</div><h2 id="info-title">Точки с историей.</h2><p class="body-copy">02 — Погореловское озеро по реестру названий.<br>03 — опубликованная точка научного сбора внутри «Северных орхидей».<br>04 — Пертозеро по картографической привязке.</p><p class="body-copy">Номер обозначает порядок остановки, галочка — завершённое наблюдение. 01 открывается из списка как карстовая лаборатория, пока не установлено название местного озера.</p><p class="body-copy">Метки показывают географическое расположение объектов экскурсии.</p>`,
      button,
    ),
  about: (button) =>
    openInfo(
      `<div class="eyebrow">ПРИРОДА КРАЯ ЧЕРЕЗ ШКОЛЬНЫЕ ПРЕДМЕТЫ</div><h2 id="info-title">Погнали в Вожегу!</h2><p class="body-copy">Учебная экскурсия объединяет географию, химию, биологию и физику. На каждой остановке можно прочитать историю, провести небольшой опыт и сформулировать наблюдение.</p><p class="body-copy">Для выступления включи «Режим показа». Стрелки ← → переключают этапы, F разворачивает страницу на весь экран, Esc закрывает исследование. На телефоне доступны те же материалы и кнопки.</p><p class="body-copy">Дневник и заметки хранятся в браузере устройства. Фотографии, тексты и схемы включены в проект. Интернет требуется для географической подложки.</p><button class="text-button" data-action="sources">Открыть источники и ограничения данных →</button>`,
      button,
    ),
  presentation: (button) => {
    const stop = STOPS.find((item) => !progress[item.id].done) || STOPS[0];
    openChapter(stop.id, button);
    setShowMode(true);
  },
  "toggle-show": () => setShowMode(!showMode),
  previous: previousStage,
  next: nextStage,
  "advance-karst": () => {
    session.karst.karstStep = (session.karst.karstStep + 1) % 3;
    renderChapter();
  },
  evaporate: () => {
    session.chemistry.evaporated = !session.chemistry.evaporated;
    renderChapter();
  },
  "back-map": () => {
    infoDialog.close();
    overview();
    $("#map").scrollIntoView({
      behavior: reduceMotion ? "instant" : "smooth",
      block: "center",
    });
  },
  "enlarge-plant": () => {
    const plant = PLANTS[session.biology.plant];
    $("#large-photo").src = plant.image;
    $("#large-photo").alt = plant.name;
    $("#photo-caption").textContent =
      `${plant.name}. ${plant.caption} Фото ${plant.author} · ${plant.license}`;
    showDialog(photoDialog);
  },
};
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-close")) {
    closeDialog(button.closest("dialog"));
    return;
  }
  if (button.dataset.stop) {
    openChapter(button.dataset.stop, button);
    return;
  }
  if (button.dataset.step !== undefined) {
    currentStep = Number(button.dataset.step);
    renderChapter();
    return;
  }
  if (button.dataset.karst !== undefined) {
    session.karst.karstStep = Number(button.dataset.karst);
    renderChapter();
    return;
  }
  if (button.dataset.plant !== undefined) {
    changePlant(Number(button.dataset.plant));
    return;
  }
  if (button.dataset.pressure) {
    session.physics.absolute = button.dataset.pressure === "absolute";
    renderChapter();
    return;
  }
  if (button.dataset.answer !== undefined) {
    const answer = Number(button.dataset.answer);
    session[STOPS[currentIndex].id].answer = answer;
    if (answer === STOPS[currentIndex].correct) markComplete();
    $("#chapter-body").innerHTML = observationMarkup(STOPS[currentIndex]);
    return;
  }
  const action = actions[button.dataset.action];
  if (action) action(button);
});
document.addEventListener("input", (event) => {
  if (event.target.id === "depth") {
    session.physics.depth = Number(event.target.value);
    updateVisual();
  }
  if (event.target.id === "concentration") {
    session.chemistry.concentration = Number(event.target.value);
    session.chemistry.evaporated = false;
    updateVisual();
    const button = $('[data-action="evaporate"]');
    if (button) button.textContent = "Испарить воду в модели →";
  }
  const id = event.target.dataset.note;
  if (id && progress[id]) {
    progress[id].notes = event.target.value.slice(0, 1000);
    persist(id);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    !chapterDialog.open ||
    photoDialog.open ||
    infoDialog.open ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  if (
    event.target.matches("input,textarea,select,summary") ||
    event.target.isContentEditable
  )
    return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    nextStage();
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    previousStage();
  }
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : chapterDialog.requestFullscreen?.();
    request?.catch(() =>
      toast("Полный экран недоступен. Режим показа продолжает работать."),
    );
  }
});
chapterDialog.addEventListener("close", () => {
  setShowMode(false);
  if (document.fullscreenElement === chapterDialog)
    document.exitFullscreen().catch(() => {});
});
[chapterDialog, infoDialog, photoDialog].forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeDialog(dialog);
  }),
);
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  overview();
  window.scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" });
});
window.addEventListener("storage", (event) => {
  if (!event.key?.startsWith("vozhega-v2-")) return;
  const id = event.key.slice("vozhega-v2-".length);
  if (!progress[id]) return;
  const changed = readJson(event.key, {});
  progress[id] = {
    done: changed.done === true,
    notes:
      typeof changed.notes === "string" ? changed.notes.slice(0, 1000) : "",
  };
  renderRoute();
});
loadProgress();
renderRoute();
setupMap();
