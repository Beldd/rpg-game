const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEditorData } = require('./loadEditorData');
const { validateContent } = require('../tools/validate-content');

const { EditorData } = loadEditorData();
const clone = o => JSON.parse(JSON.stringify(o));
const repo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game-content.json'), 'utf8'));
const check = c => validateContent(EditorData.migrate(clone(c)), { sheets: EditorData.SPRITE_SHEETS, effects: Object.keys(EditorData.NPC_EFFECTS), maxEntries: EditorData.NPC_MAX_ENTRIES });

test('built-in defaults pass the content rules', () => {
  const { errors } = check(EditorData.defaults);
  assert.equal(errors.join('\n'), '');
});

test('committed game-content.json passes the content rules', () => {
  const { errors, warnings } = check(repo.data);
  assert.equal(errors.join('\n'), '');
  assert.equal(warnings.join('\n'), '');
});

test('validator catches broken content', () => {
  const bad = clone(repo.data);
  bad.zones[1].randomEncounters.push('ghost_99');
  bad.encounters[0].rewards.dropPool.push({ name: 'Nonexistent Item', weight: 1 });
  bad.encounters[0].stats.attackMin = 99;
  bad.encounters[0].mapPosition = { tileX: 500, tileY: 2 };
  const migrated = EditorData.migrate(bad);
  migrated.encounters[0].sprite = { sheet: 'tiny_dungeon', frame: 9999 }; // migrate() would null this, so set it afterwards
  const msgs = validateContent(migrated, { sheets: EditorData.SPRITE_SHEETS, effects: Object.keys(EditorData.NPC_EFFECTS), maxEntries: EditorData.NPC_MAX_ENTRIES }).errors.join('\n');
  for (const needle of ['ghost_99', 'Nonexistent Item', 'attackMin is above', 'out of range', 'outside the map'])
    assert.ok(msgs.includes(needle), `expected an error mentioning "${needle}"\n${msgs}`);
});

test('validator warns about an unassigned random enemy', () => {
  const c = clone(repo.data);
  const extra = clone(c.encounters[0]);
  extra.id = 'bat_01'; extra.name = 'Bat'; extra.type = 'random';
  c.encounters.push(extra);
  assert.ok(check(c).warnings.some(w => w.includes('bat_01')));
});

test('validator flags duplicate names', () => {
  const c = clone(repo.data);
  c.encounters.push({ ...clone(c.encounters[0]), id: 'slime_02' });
  assert.ok(check(c).errors.some(e => e.includes('duplicate name "Slime"')));
});

test('validate() rejects things that are not game content', () => {
  assert.ok(EditorData.validate(null));
  assert.ok(EditorData.validate([]));
  assert.ok(EditorData.validate({ encounters: 'x' }));
  assert.ok(EditorData.validate({ zones: [] }));
  assert.equal(EditorData.validate(clone(repo.data)), null);
});

test('migrate() upgrades a minimal old-format encounter', () => {
  const old = { encounters: [{ id: 'old_01', name: 'Old', stats: { hp: 5, attackMin: 1, attackMax: 2, xpReward: 1 } }] };
  const m = EditorData.migrate(old);
  const e = m.encounters[0];
  assert.equal(e.tier, 'regular');
  assert.equal(e.sprite, null);
  assert.equal(JSON.stringify(e.appearsIn), '["map","dungeon"]');
  assert.equal(e.rewards.gold, 0);
  assert.equal(e.stats.speed, 8);
  assert.ok(e.abilities.length > 0);
  assert.ok(m.characters.length > 0 && m.zones.length > 0 && m.equipment.length > 0);
});

test('migrate() keeps valid designer edits', () => {
  const c = clone(repo.data);
  c.encounters[0].tier = 'boss';
  c.encounters[0].rewards.gold = 42;
  c.encounters[0].appearsIn = ['dungeon'];
  const e = EditorData.migrate(c).encounters[0];
  assert.equal(e.tier, 'boss'); assert.equal(e.rewards.gold, 42); assert.equal(JSON.stringify(e.appearsIn), '["dungeon"]');
});

test('content source priority: local override > repo file > defaults', () => {
  const local = clone(repo.data); local.encounters[0].name = 'LocalSlime';
  const fromRepo = clone(repo.data); fromRepo.encounters[0].name = 'RepoSlime';

  let g = loadEditorData();
    assert.notEqual(g.EditorData.load().encounters[0].name, 'RepoSlime');           // defaults

  g.EditorData.repoContent = g.EditorData.migrate(clone(fromRepo));
  assert.equal(g.EditorData.load().encounters[0].name, 'RepoSlime');              // repo beats defaults

  g.store['rpg-editor-data'] = JSON.stringify(local);
  assert.equal(g.EditorData.load().encounters[0].name, 'LocalSlime');             // local beats repo

  g.EditorData.clearOverride();
  assert.equal(g.EditorData.load().encounters[0].name, 'RepoSlime');              // reset returns to repo
});

test('corrupt local override falls back instead of throwing', () => {
  const g = loadEditorData({ storage: { 'rpg-editor-data': '{not json' } });
  assert.doesNotThrow(() => g.EditorData.load());
});

test('migrate() seeds the default NPCs when the list is missing', () => {
  const m = EditorData.migrate({ encounters: clone(repo.data.encounters) });
  assert.equal(m.npcs.map(n => n.id).sort().join(','), 'doctor,innkeeper,potion_master,wizard');
});

test('migrate() keeps NPC edits and does not bring a deleted NPC back', () => {
  const c = clone(repo.data);
  c.npcs = clone(EditorData.defaults.npcs).filter(n => n.id !== 'doctor');
  c.npcs.find(n => n.id === 'innkeeper').services[0].cost = 75;
  const m = EditorData.migrate(c);
  assert.equal(m.npcs.some(n => n.id === 'doctor'), false);
  assert.equal(m.npcs.find(n => n.id === 'innkeeper').services[0].cost, 75);
});

test('migrate() repairs malformed NPC entries', () => {
  const c = clone(repo.data);
  c.npcs = [
    { id: 'x', services: [{ effect: 'nonsense', cost: 5 }, { effect: 'resurrect', cost: -4 }, { effect: 'resurrect', cost: 9 }],
      sells: [{ item: 'Potion', price: 'free', perVisit: 0 }, { price: 3 }], sprite: { sheet: 'nope', frame: 1 } },
    null,
    { name: 'no id' },
  ];
  const m = EditorData.migrate(c);
  assert.equal(m.npcs.length, 1);
  const n = m.npcs[0];
  assert.equal(n.name, 'x');
  assert.equal(n.sprite, null);
  assert.equal(JSON.stringify(n.services), '[{"effect":"resurrect","cost":0}]');
  assert.equal(JSON.stringify(n.sells), '[{"item":"Potion","price":0,"perVisit":null}]');
});

test('validator catches bad NPC content', () => {
  const c = clone(repo.data);
  c.npcs = clone(EditorData.defaults.npcs);
  const inn = c.npcs.find(n => n.id === 'innkeeper');
  inn.services.push({ effect: 'resurrect', cost: 10 }, { effect: 'reset_dungeon', cost: 0 });
  inn.sells = [{ item: 'Potion', price: 5, perVisit: null }];                // 3 services + a shop = 4 entries
  c.npcs.find(n => n.id === 'potion_master').sells.push({ item: 'Unobtainium', price: 9, perVisit: null });
  const migrated = EditorData.migrate(c);
  migrated.npcs.find(n => n.id === 'doctor').services[0].effect = 'teleport';  // set after migrate, which would drop it
  const msgs = validateContent(migrated, { sheets: EditorData.SPRITE_SHEETS, effects: Object.keys(EditorData.NPC_EFFECTS), maxEntries: EditorData.NPC_MAX_ENTRIES }).errors.join('\n');
  for (const needle of ['offers 4 things', 'Unobtainium', 'teleport'])
    assert.ok(msgs.includes(needle), `expected an error mentioning "${needle}"\n${msgs}`);
});

test('default NPCs sell and offer only things that exist', () => {
  const { errors } = check({ ...clone(repo.data), npcs: clone(EditorData.defaults.npcs) });
  assert.equal(errors.join('\n'), '');
});
