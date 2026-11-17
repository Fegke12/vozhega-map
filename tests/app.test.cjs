// Run with: node --test tests/app.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function application(seed = {}, denyStorage = false) {
  const nodes = new Map();
  const events = {};
  const storage = new Map(Object.entries(seed));
  const doc = { activeElement: null };
  function element(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const attributes = new Map();
    const classes = new Set();
    const node = {
      open: false, hidden: false, textContent: '', innerHTML: '', value: '',
      dataset: {}, style: { setProperty() {} },
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle(name, force) {
          const enable = force ?? !classes.has(name);
          if (enable) classes.add(name); else classes.delete(name);
          return enable;
        },
      },
      setAttribute: (key, value) => attributes.set(key, String(value)),
      removeAttribute: (key) => attributes.delete(key),
      querySelector: (key) => element(key),
      querySelectorAll: () => [],
      getAttribute: (key) => attributes.get(key),
      addEventListener(type, handler) { events[`${selector}:${type}`] = handler; },
      append(child) { child.parentElement = node; },
      showModal() { node.open = true; }, close() { node.open = false; },
      focus() { doc.activeElement = node; },
    };
    nodes.set(selector, node);
    return node;
  }
  doc.body = element('body');
  doc.activeElement = doc.body;
  doc.querySelector = element;
  doc.querySelectorAll = () => [];
  doc.addEventListener = (type, handler) => { events[`document:${type}`] = handler; };
  const context = vm.createContext({
    document: doc, matchMedia: () => ({ matches: false }),
    window: { scrollTo() {}, addEventListener(type, handler) { events[`window:${type}`] = handler; } },
    localStorage: {
      getItem(key) { if (denyStorage) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (denyStorage) throw Error('blocked'); storage.set(key, value); },
    },
    setTimeout: () => 1, clearTimeout() {}, console,
  });
  for (const file of ['content.js', 'scenes.js', 'biology.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), context);
  }
  return { read: (code) => vm.runInContext(code, context), element, storage, events };
}

test('all stops have valid answers, sources and local images', () => {
  const app = application();
  const stops = app.read('STOPS');
  const sourceIds = new Set(app.read('SOURCES').map((source) => source.id));
  assert.equal(new Set(stops.map((stop) => stop.id)).size, 4);
  for (const stop of stops) {
    assert.ok(stop.correct >= 0 && stop.correct < stop.answers.length);
    for (const id of stop.sources) assert.ok(sourceIds.has(id), `${stop.id}: ${id}`);
    if (stop.coords) {
      assert.equal(stop.coords.length, 2);
      assert.ok(stop.coords[0] >= -90 && stop.coords[0] <= 90);
      assert.ok(stop.coords[1] >= -180 && stop.coords[1] <= 180);
    }
  }
  for (const item of [...app.read('PLANTS'), ...app.read('LAKES')]) {
    assert.ok(fs.existsSync(path.join(root, 'dist', item.image)), item.image);
  }
  assert.equal(app.read('SITE_URL'), 'https://fegke12.github.io/vozhega-map/');
});

test('red book places and species have consistent two-way links', () => {
  const app = application();
  const plants = app.read('RED_BOOK_PLANTS');
  const places = app.read('PLANT_PLACES');
  assert.equal(plants.length, 3);
  assert.equal(places.length, 3);
  assert.equal(new Set(plants.map((plant) => plant.id)).size, plants.length);
  for (const plant of plants) {
    assert.ok(fs.existsSync(path.join(root, 'dist', plant.image)));
    assert.ok(plant.description.length > 50 && plant.description.length < 500);
    assert.ok(!/сверк|атлас|координат|автор/i.test(plant.description));
    for (const id of plant.places) {
      const place = places.find((item) => item.id === id);
      assert.ok(place && place.plantIds.includes(plant.id));
    }
  }
  for (const place of places) {
    for (const id of place.plantIds) {
      assert.ok(plants.some((plant) => plant.id === id && plant.places.includes(place.id)));
    }
  }
  assert.equal(places.find((place) => place.id === 'maryinskaya').coords.join(','), '60.54,40.419');
  assert.equal(places.find((place) => place.id === 'kubena').coords.join(','), '60.448,40.777');
});

test('biology map replaces the old chapter and restores the excursion', () => {
  const app = application();
  app.read('openChapter("biology")');
  assert.equal(app.element('#chapter-dialog').open, false);
  assert.equal(app.element('#biology-sidebar').hidden, false);
  assert.equal(app.element('#general-sidebar').hidden, true);
  assert.equal(app.element('body').classList.contains('biology-mode'), true);
  app.read('exitBiology()');
  assert.equal(app.element('#biology-sidebar').hidden, true);
  assert.equal(app.element('#general-sidebar').hidden, false);
});

test('book selection preserves a valid clicked locality and rejects invalid plant IDs', () => {
  const app = application();
  app.read('RedBook.open("calceolus", "maryinskaya")');
  assert.equal(app.read('RedBook.currentPlant().id'), 'calceolus');
  assert.equal(app.read('RedBook.currentPlace().id'), 'maryinskaya');
  app.read('RedBook.open("macranthos", "maryinskaya")');
  assert.equal(app.read('RedBook.currentPlace().id'), 'orchids');
  app.read('RedBook.open("not-a-plant")');
  assert.equal(app.read('RedBook.currentPlant().id'), 'macranthos');
});

test('malformed and primitive saved values do not break startup', () => {
  for (const value of ['{broken', 'null', 'false', '42', '"text"', '[]']) {
    const app = application({ 'vozhega-v2-karst': value });
    assert.equal(app.read('progress.karst.done'), false);
    assert.equal(app.read('progress.karst.notes'), '');
    assert.equal(app.read('completedCount()'), 0);
  }
});

test('legacy progress migrates and long notes are bounded', () => {
  const app = application({
    'vozhega-expedition-v1': '["karst"]',
    'vozhega-v2-chemistry': JSON.stringify({ done: true, notes: 'я'.repeat(1100) }),
  });
  assert.equal(app.read('completedCount()'), 2);
  assert.equal(app.read('progress.chemistry.notes.length'), 1000);
});

test('denied storage leaves a working session and a visible dialog notification', () => {
  const app = application({}, true);
  app.read('chapterDialog.open = true; persist("karst")');
  assert.equal(app.read('storageWarning'), true);
  assert.equal(app.element('#toast').parentElement, app.element('#chapter-dialog'));
  assert.match(app.element('#toast').textContent, /ограничил сохранение/);
});

test('physics uses water pressure and adds atmospheric pressure once', () => {
  const app = application();
  app.read('currentIndex = 3; session.physics.depth = 13.8; updateVisual()');
  assert.equal(app.element('#pressure-value').textContent, '135,4 кПа');
  app.read('session.physics.absolute = true; updateVisual()');
  assert.equal(app.element('#pressure-value').textContent, '236,7 кПа');
  app.read('session.physics.depth = 0; updateVisual()');
  assert.equal(app.element('#pressure-value').textContent, '101,3 кПа');
});

test('evaporation hides all water and zero concentration hides the salt residue', () => {
  const app = application();
  app.read('currentIndex = 1; session.chemistry.evaporated = true; updateVisual()');
  assert.equal(app.element('#sample-water').getAttribute('opacity'), '0');
  app.read('session.chemistry.concentration = 0; updateVisual()');
  assert.equal(app.element('#salt-particles').getAttribute('opacity'), '0');
  app.read('session.chemistry.evaporated = false; updateVisual()');
  assert.equal(app.element('#sample-water').getAttribute('opacity'), '1');
});

test('karst stages reveal the cavity before the lake', () => {
  const app = application();
  for (let stage = 0; stage <= 2; stage++) {
    app.read(`session.karst.karstStep = ${stage}; updateVisual()`);
    assert.equal(app.element('#cavity').getAttribute('opacity'), stage >= 1 ? '1' : '0');
    assert.equal(app.element('#karst-lake').getAttribute('opacity'), stage === 2 ? '1' : '0');
  }
});

test('storage events refresh progress, including clearing storage in another tab', () => {
  const app = application();
  app.storage.set('vozhega-v2-biology', JSON.stringify({ done: true, notes: 'Новая заметка' }));
  app.events['window:storage']({ key: 'vozhega-v2-biology' });
  assert.equal(app.read('completedCount()'), 1);
  assert.equal(app.read('progress.biology.notes'), 'Новая заметка');
  app.storage.clear();
  app.events['window:storage']({ key: null });
  assert.equal(app.read('completedCount()'), 0);
  assert.equal(app.read('progress.biology.notes'), '');
});
