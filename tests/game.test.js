const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./loadEditorData');

test('XP: a level-up happens at the threshold and carries the remainder', () => {
  const { GameState } = loadGame();
  const c = GameState.party[0];
  const before = { lvl: c.level, hp: c.maxHp };
  const r = GameState.awardXp(c, 60);
  assert.equal(r.levelUps, 1);
  assert.equal(c.level, before.lvl + 1);
  assert.equal(c.maxHp, before.hp + 5);
  assert.equal(c.xp, 10);
});

test('XP: a big grant levels up more than once', () => {
  const { GameState } = loadGame();
  const r = GameState.awardXp(GameState.party[0], 120);
  assert.equal(r.levelUps, 2);
  assert.equal(r.statGains.maxHp, 10);
});

test('equip moves an item from inventory to the character and swaps back', () => {
  const { GameState } = loadGame();
  const c = GameState.party[0];
  const sword = GameState.inventory.find(i => i.slot === 'primary');
  assert.ok(sword, 'starting inventory should include a primary-slot weapon');
  const n = GameState.inventory.length;
  GameState.equipItem(c, sword);
  assert.equal(c.equipment.primary, sword);
  assert.equal(GameState.inventory.length, n - 1);
  GameState.unequipItem(c, 'primary');
  assert.equal(c.equipment.primary, null);
  assert.equal(GameState.inventory.length, n);
});

test('save round-trip restores party, inventory and gold', () => {
  const { GameState, SaveSystem } = loadGame();
  GameState.gold = 77;
  GameState.party[0].level = 4;
  assert.ok(SaveSystem.saveToSlot(1) !== false);
  GameState.gold = 0; GameState.party[0].level = 1;
  assert.equal(SaveSystem.loadFromSlot(1), true);
  assert.equal(GameState.gold, 77);
  assert.equal(GameState.party[0].level, 4);
});

test('autosave slot is separate from manual slots', () => {
  const { GameState, SaveSystem, store } = loadGame();
  GameState.gold = 5;
  SaveSystem.saveToSlot('auto');
  assert.ok('rpg-save-slot-auto' in store);
  assert.ok(!('rpg-save-slot-1' in store));
  assert.equal(SaveSystem.loadFromSlot('auto'), true);
});

test('an old save without gold or party rows loads with safe defaults', () => {
  const { GameState, SaveSystem, EditorData, store } = loadGame();
  const party = JSON.parse(JSON.stringify(GameState.party)).map(m => { delete m.row; return m; });
  store['rpg-save-slot-2'] = JSON.stringify({ party, inventory: [], savedAt: 1 });
  assert.equal(SaveSystem.loadFromSlot(2), true);
  assert.equal(GameState.gold, 0);
  assert.ok(GameState.party.every(m => m.row === 'front' || m.row === 'back'));
});

test('loading an empty or corrupt slot fails without touching state', () => {
  const { GameState, SaveSystem, store } = loadGame();
  GameState.gold = 9;
  assert.equal(SaveSystem.loadFromSlot(3), false);
  store['rpg-save-slot-3'] = '{broken';
  assert.equal(SaveSystem.loadFromSlot(3), false);
  assert.equal(GameState.gold, 9);
});

test('weighted drop pool never returns an item outside the pool', () => {
  const { GameState } = loadGame();
  const pool = [{ name: 'Potion', stackable: true, weight: 1 }, { name: 'Antidote', stackable: true, weight: 3 }];
  for (let i = 0; i < 200; i++) {
    const d = GameState.rollForDropFromPool(pool, 1);
    assert.ok(['Potion', 'Antidote'].includes(d), `unexpected drop ${d}`);
  }
  assert.equal(GameState.rollForDropFromPool(pool, 0), null);
});
