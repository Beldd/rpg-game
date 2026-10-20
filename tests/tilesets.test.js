const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Tilesets = vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'tilesets.js'), 'utf8') + '\n;Tilesets', {});

test('a tileset is recognised by its registered name', () => {
  assert.strictEqual(Tilesets.resolve({ name: 'kenney_tiny_town' }).name, 'kenney_tiny_town');
});

test('Tiled default names are told apart by image folder', () => {
  // Every Kenney sheet is called tilemap_packed.png, so Tiled names them all the same.
  const town = Tilesets.resolve({ name: 'tilemap_packed', image: '../assets/kenny/tiny_town/Tilemap/tilemap_packed.png' });
  const farm = Tilesets.resolve({ name: 'tilemap_packed', image: '../assets/kenny/tiny_farm/Tilemap/tilemap_packed.png' });
  assert.strictEqual(town.name, 'kenney_tiny_town');
  assert.strictEqual(farm.name, 'kenney_tiny_farm');
});

test('Windows-style image paths still resolve', () => {
  const r = Tilesets.resolve({ name: 'x', image: '..\\assets\\kenny\\tiny_dungeon\\Tilemap\\tilemap_packed.png' });
  assert.strictEqual(r.name, 'kenney_tiny_dungeon');
});

test('an unknown tileset is not resolved', () => {
  assert.strictEqual(Tilesets.resolve({ name: 'mystery', image: 'assets/other/sheet.png' }), null);
});

test('every registered sheet exists in the repo and lists valid local ids', () => {
  for (const [name, def] of Object.entries(Tilesets.SETS)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', def.image)), `${name}: missing ${def.image}`);
    def.blocked.forEach(id => assert.ok(Number.isInteger(id) && id >= 0 && id < 132, `${name}: bad id ${id}`));
    assert.strictEqual(new Set(def.blocked).size, def.blocked.length, `${name}: duplicate ids in blocked list`);
  }
});

test('the original wall rule is preserved: dungeon local id 26 (saved as 27) blocks', () => {
  assert.ok(Tilesets.SETS.kenney_tiny_dungeon.blocked.includes(26));
});

test('roof layers are recognised by name', () => {
  assert.ok(Tilesets.isRoofName('roof'));
  assert.ok(Tilesets.isRoofName('Roof_2'));
  assert.ok(!Tilesets.isRoofName('ground'));
  assert.ok(!Tilesets.isRoofName('decor'));
  assert.ok(Tilesets.isRoofName('rooftop_garden')); // anything starting with "roof" counts
});

test('the designer-added Tiny Dungeon wall tiles block', () => {
  [6, 7, 8, 18, 19, 20, 30, 57, 58, 59].forEach(id =>
    assert.ok(Tilesets.SETS.kenney_tiny_dungeon.blocked.includes(id), `tile ${id}`));
});

test('the Tiny Town well blocks', () => {
  assert.ok(Tilesets.SETS.kenney_tiny_town.blocked.includes(92));
  assert.ok(Tilesets.SETS.kenney_tiny_town.blocked.includes(104));
});
