# Fantasy of Arcadia

A playable, browser-based, SNES-style RPG prototype with its own content-authoring tool. Turn-based battles in the style of Final Fantasy 1, a town, a dungeon, loot, leveling, saving, and a design editor that lets non-programmers change game content without touching code.

**Status:** playable proof of concept, v0.2.0. The rules, menus and tooling are real; most of the art is placeholder.

**[▶ Play it in your browser](https://beldd.github.io/rpg-game/)** (no install; keyboard: arrows to move, Enter to confirm, Esc to go back, P for the menu)

| | |
|---|---|
| ![Title screen](docs/img/title.png) | ![Town map](docs/img/map.png) |
| ![Battle](docs/img/battle.png) | ![Party menu](docs/img/menu.png) |

## What this project demonstrates

This is a solo project. I am a games producer and product manager by background, so it is deliberately a showcase of how I scope and run a product as much as the game itself.

- **Scope and definition of done.** "Complete 2D" is written down as three ordered parts (zones, procedural dungeons, character progression), with out-of-scope items named. See [docs/DESIGN.md](docs/DESIGN.md).
- **An internal tool treated as a product.** The editor has users (designers), jobs to be done, and a content pipeline. It went from "edits live in one browser" to "export a file, commit it, everyone sees it", with the active content source shown on screen so problems are easy to diagnose.
- **Decisions with reasons.** A decision log records what was chosen, what was rejected and why, including things deliberately deferred.
- **Small, verified increments.** Work ships as one checkpoint at a time and is tested before the next begins. Bugs found along the way, their causes and their fixes are written down rather than hidden.
- **Honest status.** A known-issues list and a roadmap with deferred items are kept current.

## The design editor

`tools/editor.html` ([try it live](https://beldd.github.io/rpg-game/tools/editor.html)) is a standalone content tool for encounters, zones, consumables, equipment and characters.

![Design editor](docs/img/editor.png)

- Edit enemy stats, abilities (weighted), rewards (XP, gold, drop pool), tier (regular, rare, elite, boss) and sprite, picked from a tile sheet.
- Choose which maps a static encounter appears on, and which enemies can appear as random encounters in each zone.
- **Export** to `game-content.json`, **Import** it back, or **Reset to repo content**. Commit the file and the game loads it as its base content. Browser-local edits override it on one machine only, and the game's title screen and the editor both say which source is active.

## Run it locally

The game is plain HTML and JavaScript on Phaser 3 with no build step.

1. Serve this folder with any static web server (for example `python3 -m http.server`).
2. Open `index.html` for the game and `tools/editor.html` for the editor, using the same address and browser profile for both.

An internet connection is needed for the Phaser CDN.

## Current scope

| Area | Today |
|---|---|
| Exploration | A town map and a dungeon, grid movement, one NPC |
| Encounters | Static (visible enemy you can challenge) and random (per-zone step counter) |
| Battle | Round-based: Attack, Magic, Defend, Change Row, Flee; party of up to five |
| Progression | XP and levels, item drops, gold rewards |
| Menus | Party, Equip, Items, Save/Load |
| Saving | Three slots plus an autosave after each victory |
| Content tool | The editor above |

## Roadmap

1. Hidden building interiors in towns: working in one test building, to be rolled out to the rest (zone borders, doors, rooms and NPC positions are map data).
2. Zones: an overworld, towns and dungeons with distinct encounter rules.
3. Procedurally generated dungeons (target 10–15 minutes each, with rare, elite and boss guards).
4. Character progression: levels, abilities, items.

Details, rationale and out-of-scope items are in [docs/DESIGN.md](docs/DESIGN.md). Technical notes are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## How it was built

Designed, directed and tested by me. Implementation was done with AI assistance (Claude), working through the checkpoint-by-checkpoint process described in the design notes: I set the scope and priorities, made the design calls, and playtested each change before the next one started. Logic and content have automated tests (`npm test`) and a content validator (`npm run validate`); scenes and menus are verified by playing.

<!-- Edit this section to say exactly what you want it to say. -->

## Credits and licenses

- Game engine: [Phaser 3](https://phaser.io) (MIT).
- Tiles and sprites: "Tiny Dungeon" by [Kenney](https://kenney.nl) (check the license that ships with the pack and keep it in `assets/kenny/`).
- Everything else in this repository is my own work. <!-- Add a LICENSE file when you decide how the code may be used. -->
