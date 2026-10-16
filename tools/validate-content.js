#!/usr/bin/env node
// Content validator: checks game-content.json (or a file you pass) against
// the rules the game silently relies on. Exit code 1 if any error is found.
//   node tools/validate-content.js [path/to/content.json]
// Errors = the game would misbehave. Warnings = probably a mistake.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

function mapInfo(file) {
  const m = readJson(path.join(ROOT, 'assets', file));
  return { width: m.width, height: m.height, layers: m.layers };
}

/**
 * @param content  the content object (the `data` part of an export)
 * @param opts.sheets  EditorData.SPRITE_SHEETS (for sprite frame checks)
 */
function validateContent(content, opts = {}) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  const maps = { map: mapInfo('map.json'), dungeon: mapInfo('dungeon.json') };

  const dupes = (list, key, label) => {
    const seen = new Set();
    (list || []).forEach(x => {
      if (seen.has(x[key])) err(`${label}: duplicate ${key} "${x[key]}"`);
      seen.add(x[key]);
    });
  };
  dupes(content.encounters, 'id', 'Encounters');
  dupes(content.encounters, 'name', 'Encounters');
  dupes(content.consumables, 'name', 'Consumables');
  dupes(content.equipment, 'name', 'Equipment');
  dupes(content.characters, 'id', 'Characters');
  dupes(content.zones, 'id', 'Zones');

  const encIds = new Set((content.encounters || []).map(e => e.id));
  const itemNames = new Set([
    ...(content.consumables || []).map(c => c.name),
    ...(content.equipment || []).map(e => e.name),
  ]);

  const assignedRandom = new Set();
  (content.zones || []).forEach(z => {
    (z.randomEncounters || []).forEach(id => {
      assignedRandom.add(id);
      if (!encIds.has(id)) err(`Zone "${z.id}": random encounter "${id}" does not exist`);
    });
    if (z.enabled && !(z.randomEncounters || []).length) warn(`Zone "${z.id}" has random encounters enabled but no enemies assigned`);
  });

  (content.encounters || []).forEach(e => {
    const tag = `Encounter "${e.id}"`;
    const s = e.stats || {};
    if (!(s.hp > 0)) err(`${tag}: hp must be above 0`);
    if (!(s.attackMin <= s.attackMax)) err(`${tag}: attackMin is above attackMax`);
    if (!(s.attackMin >= 0)) err(`${tag}: attackMin must be 0 or more`);
    const ab = e.abilities || [];
    if (!ab.length) err(`${tag}: has no abilities`);
    else if (!ab.some(a => a.weight > 0)) err(`${tag}: all ability weights are 0`);
    (e.rewards?.dropPool || []).forEach(d => {
      if (!itemNames.has(d.name)) err(`${tag}: drop "${d.name}" is not a known item`);
      if (!(d.weight > 0)) warn(`${tag}: drop "${d.name}" has weight 0 and can never drop`);
    });
    const dc = e.rewards?.dropChance;
    if (dc !== undefined && !(dc >= 0 && dc <= 1)) err(`${tag}: dropChance must be between 0 and 1`);
    if (e.sprite && opts.sheets) {
      const sh = opts.sheets[e.sprite.sheet];
      if (!sh) err(`${tag}: unknown sprite sheet "${e.sprite.sheet}"`);
      else if (!(e.sprite.frame >= 0 && e.sprite.frame < sh.cols * sh.rows)) err(`${tag}: sprite frame ${e.sprite.frame} is out of range`);
    }
    if (e.type === 'static') {
      for (const [where, mapKey, posKey] of [['map', 'map', 'mapPosition'], ['dungeon', 'dungeon', 'dungeonPosition']]) {
        if (!(e.appearsIn || []).includes(where)) continue;
        const p = e[posKey], m = maps[mapKey];
        if (!p) err(`${tag}: missing ${posKey}`);
        else if (!(p.tileX >= 0 && p.tileX < m.width && p.tileY >= 0 && p.tileY < m.height))
          err(`${tag}: ${posKey} (${p.tileX},${p.tileY}) is outside the ${mapKey} (${m.width}x${m.height})`);
      }
    }
  });

  const randomOnly = (content.encounters || []).filter(e => e.type === 'random');
  randomOnly.forEach(e => { if (!assignedRandom.has(e.id)) warn(`Random encounter "${e.id}" is not assigned to any zone`); });

  (content.characters || []).forEach(c => {
    if (!(c.startingHp > 0)) err(`Character "${c.id}": startingHp must be above 0`);
    if (!(c.baseStats?.attackMin <= c.baseStats?.attackMax)) err(`Character "${c.id}": attackMin is above attackMax`);
  });

  // Tiled object layer vs content
  const zoneIds = new Set((content.zones || []).map(z => z.id));
  for (const [key, m] of Object.entries(maps)) {
    const layer = (m.layers || []).find(l => l.type === 'objectgroup' && l.name === 'objects');
    if (!layer) { if (key === 'map') warn('map.json has no "objects" layer; code fallbacks are in use'); continue; }
    layer.objects.forEach(o => {
      const prop = n => (o.properties || []).find(p => p.name === n)?.value;
      const tx = Math.floor(o.x / 16), ty = Math.floor(o.y / 16);
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) err(`${key}.json object "${o.name}" is outside the map`);
      if (o.type === 'zone' && !zoneIds.has(prop('zone'))) err(`${key}.json zone object "${o.name}" refers to unknown zone "${prop('zone')}"`);
    });
    const roomNames = new Set(layer.objects.filter(o => o.type === 'room').map(o => o.name));
    layer.objects.filter(o => o.type === 'door' && (o.properties || []).some(p => p.name === 'target' && p.value === 'room')).forEach(o => {
      const room = (o.properties || []).find(p => p.name === 'room')?.value;
      if (!roomNames.has(room)) err(`${key}.json door "${o.name}" refers to unknown room "${room}"`);
    });
    roomNames.forEach(n => {
      const hasDoor = layer.objects.some(o => o.type === 'door' && (o.properties || []).some(p => p.name === 'room' && p.value === n));
      if (!hasDoor) warn(`${key}.json room "${n}" has no door, so it can never be revealed`);
    });
  }
  return { errors, warnings };
}

module.exports = { validateContent };

if (require.main === module) {
  const file = process.argv[2] || path.join(ROOT, 'game-content.json');
  const { loadEditorData } = require('../tests/loadEditorData');
  const { EditorData } = loadEditorData();
  const raw = readJson(file);
  const content = EditorData.migrate(JSON.parse(JSON.stringify(raw.data || raw)));
  const { errors, warnings } = validateContent(content, { sheets: EditorData.SPRITE_SHEETS });
  warnings.forEach(w => console.log('WARN  ' + w));
  errors.forEach(e => console.log('ERROR ' + e));
  console.log(`${path.relative(process.cwd(), file) || file}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
