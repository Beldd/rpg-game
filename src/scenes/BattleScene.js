/**
 * BattleScene.js
 * --------------
 * Round-based combat with FF1-style mechanics:
 * 1. INPUT_PHASE: player queues actions for every living party member
 * 2. EXECUTING: all actions resolve in Speed order (highest first)
 * 3. End-of-round: status effects tick, then repeat
 *
 * Layout (320x240):
 *   Y:  0- 40  message strip
 *   Y: 40-170  middle — enemy (left), party (right)
 *   Y:170-240  bottom — menus (left)
 */
class BattleScene extends Phaser.Scene {
  constructor() { super({ key: 'BattleScene' }); }

  init(data) {
    this.encounterId = (data && data.encounterId) ? data.encounterId : 'slime_01';
  }

  create() {
    const { width, height } = this.cameras.main;
    this.party = GameState.party;

    const encounterDef = EditorData.getEncounter(this.encounterId);
    this.enemy = {
      name:       encounterDef ? encounterDef.name                : 'Slime',
      hp:         encounterDef ? encounterDef.stats.hp            : 20,
      maxHp:      encounterDef ? encounterDef.stats.hp            : 20,
      attackMin:  encounterDef ? encounterDef.stats.attackMin     : 2,
      attackMax:  encounterDef ? encounterDef.stats.attackMax     : 6,
      xpReward:   encounterDef ? encounterDef.stats.xpReward      : 10,
      speed:      encounterDef ? (encounterDef.stats.speed || 8)  : 8,
      dropPool:   encounterDef ? encounterDef.rewards.dropPool    : null,
      dropChance: encounterDef ? encounterDef.rewards.dropChance  : 0.5,
      abilities:  encounterDef ? encounterDef.abilities           : [],
      exposeWeaknessTurns: 0,
      activeBuffs: [],
    };

    // ── Background ──────────────────────────────────────────────────
    this.add.rectangle(0, 0, width, height, 0x0a0a1a).setOrigin(0, 0);

    // ── Panel borders ───────────────────────────────────────────────
    const borderCol = 0x334455;
    // Horizontal dividers
    this.add.rectangle(0,   40, width, 1, borderCol).setOrigin(0, 0);
    this.add.rectangle(0,  170, width, 1, borderCol).setOrigin(0, 0);
    // Vertical divider (enemy | party)
    this.add.rectangle(155, 40, 1, 130, borderCol).setOrigin(0, 0);

    // Subtle panel fills
    this.add.rectangle(0,   0, width, 40,  0x0d0d20, 0.8).setOrigin(0, 0); // message
    this.add.rectangle(0,  40, 155,  130, 0x0a1020, 0.6).setOrigin(0, 0); // enemy
    this.add.rectangle(156,40, 164,  130, 0x0a1520, 0.6).setOrigin(0, 0); // party
    this.add.rectangle(0, 170, width, 70,  0x0d1020, 0.8).setOrigin(0, 0); // bottom

    // ── Message strip ───────────────────────────────────────────────
    this.messageTextEl = domText.create(width / 2, 20,
      `A wild ${this.enemy.name} appears!`,
      { fontSize: 12, color: '#e0e0ff' }
    );
    this.messageTextEl.style.whiteSpace = 'normal';
    this.messageTextEl.style.width = `${(width - 20) * domText.ZOOM}px`;

    // ── Enemy area (left panel) ─────────────────────────────────────
    const enemyCenterX = 77;
    const enemyCenterY = 90;
    this.enemySprite = this.add.image(enemyCenterX, enemyCenterY, 'enemy').setScale(2.5);

    // Enemy name
    domText.create(enemyCenterX, 45, this.enemy.name,
      { fontSize: 10, color: '#ff8888' });

    // Enemy HP bar
    const eBarW = 120, eBarX = 10, eBarY = 155;
    this.add.rectangle(eBarX, eBarY, eBarW, 7, 0x222233).setOrigin(0, 0.5);
    this.enemyHpBarFg = this.add.rectangle(eBarX, eBarY, eBarW, 7, 0xcc3333).setOrigin(0, 0.5);

    // Enemy HP numeric
    this.enemyHpText = domText.create(eBarX + eBarW + 2, eBarY,
      `${this.enemy.hp}/${this.enemy.maxHp}`,
      { fontSize: 8, color: '#ff8888', align: 'left' });

    // ── Party area (right panel) ────────────────────────────────────
    // Per row (26px): sprite | name+bars | numerics
    const CHAR_COLORS = [0x4488ff, 0xff8844, 0x44cc44, 0xcc44cc, 0xffcc44];
    const panelLeft  = 156;
    const spriteW    = 14;
    const spriteX    = panelLeft + 2 + spriteW / 2;  // 165
    const nameBarX   = panelLeft + 2 + spriteW + 6;  // 178, extra gap after sprite
    const barW       = 70;
    const numX       = nameBarX + barW + 8;           // 256, clear of bar right edge
    const rowH       = 26;
    const midZoneTop = 40;

    this.partyHpBarsFg      = [];
    this.partyMpBarsFg      = [];
    this.partyHpTexts       = [];
    this.partyMpTexts       = [];
    this.partyRowHighlights = [];
    this.partyNameTexts     = [];
    this.partySprites       = [];

    this.party.forEach((member, i) => {
      const rowY   = midZoneTop + i * rowH;
      const nameY  = rowY + 4;
      const hpBarY = rowY + 13;
      const mpBarY = rowY + 21;
      const color  = CHAR_COLORS[i] || 0xffffff;

      // Full-row highlight for blink (invisible by default)
      const highlight = this.add.rectangle(panelLeft, rowY, width - panelLeft, rowH, 0xffffff, 0)
        .setOrigin(0, 0);
      this.partyRowHighlights.push(highlight);

      // Placeholder sprite (colored rectangle, LEFT side of row)
      const sprite = this.add.rectangle(spriteX, rowY + rowH / 2, spriteW, 20, color).setOrigin(0.5);
      this.partySprites.push(sprite);

      // Name (after sprite)
      const nameTxt = domText.create(nameBarX, nameY, member.name,
        { fontSize: 9, color: '#ffffff', align: 'left' });
      this.partyNameTexts.push(nameTxt);

      // HP bar
      this.add.rectangle(nameBarX, hpBarY, barW, 5, 0x222233).setOrigin(0, 0.5);
      const hpFg = this.add.rectangle(nameBarX, hpBarY, barW, 5, 0x33cc66).setOrigin(0, 0.5);
      this.partyHpBarsFg.push(hpFg);

      // MP bar
      this.add.rectangle(nameBarX, mpBarY, barW, 5, 0x222233).setOrigin(0, 0.5);
      const mpFg = this.add.rectangle(nameBarX, mpBarY, barW, 5, 0x3366cc).setOrigin(0, 0.5);
      this.partyMpBarsFg.push(mpFg);

      // HP numeric
      const hpTxt = domText.create(numX, hpBarY, `${member.hp}/${member.maxHp}`,
        { fontSize: 7, color: '#88ffaa', align: 'left' });
      this.partyHpTexts.push(hpTxt);

      // MP numeric
      const mpTxt = domText.create(numX, mpBarY, `${member.mp}/${member.maxMp}`,
        { fontSize: 7, color: '#88aaff', align: 'left' });
      this.partyMpTexts.push(mpTxt);
    });

    // ── Menu state ──────────────────────────────────────────────────
    this.currentMenuOptions = [];
    this.selectedIndex = 0;
    this.menuTexts = [];
    this.menuCursorEl = null;
    this.menuCursorBaseY = 182;
    this.menuStack = [];

    // ── Round state ─────────────────────────────────────────────────
    this.actionQueue = [];
    this.currentInputIndex = 0;

    // ── Input ───────────────────────────────────────────────────────
    this.cursors  = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.escKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // ── Active character indicator label ────────────────────────────
    // Shows which party member is currently inputting their action.
    this.activeCharIndicatorEl = domText.create(
      panelLeft + 4, midZoneTop - 10,
      '', { fontSize: 8, color: '#ffff00', align: 'left' }
    );

    this.battleState = 'INPUT_PHASE';
    this.updateBars();
    this.startInputPhase();
    this.cameras.main.fadeIn(400, 0, 0, 0);
    domText.fadeIn();
  }

  // ── BARS ─────────────────────────────────────────────────────────────────────

  updateBars() {
    const eBarW = 120;
    this.enemyHpBarFg.width = eBarW * Math.max(0, this.enemy.hp / this.enemy.maxHp);
    domText.setText(this.enemyHpText, `${this.enemy.hp}/${this.enemy.maxHp}`);

    const barW = 70;
    this.party.forEach((member, i) => {
      this.partyHpBarsFg[i].width = barW * Math.max(0, member.hp / member.maxHp);
      this.partyMpBarsFg[i].width = barW * Math.max(0, member.mp / member.maxMp);
      domText.setText(this.partyHpTexts[i], `${member.hp}/${member.maxHp}`);
      domText.setText(this.partyMpTexts[i], `${member.mp}/${member.maxMp}`);
    });
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  randomInRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  getEnemyEffectiveStats() {
    const e = { attackMin: this.enemy.attackMin, attackMax: this.enemy.attackMax };
    (this.enemy.activeBuffs || []).forEach(({ stat, amount }) => {
      if (e[stat] !== undefined) e[stat] += amount;
    });
    return e;
  }

  dealDamageToEnemy(rawDamage) {
    const wasModified = this.enemy.exposeWeaknessTurns > 0;
    const finalDamage = wasModified ? Math.floor(rawDamage * 1.2) : rawDamage;
    this.enemy.hp = Math.max(0, this.enemy.hp - finalDamage);
    return { rawDamage, finalDamage, wasModified };
  }

  formatDamageText({ rawDamage, finalDamage, wasModified }) {
    return wasModified
      ? `${rawDamage} -> ${finalDamage} damage (Exposed)`
      : `${finalDamage} damage`;
  }

  /**
   * Flashes the enemy sprite with a tint color for 150ms.
   * white (0xffffff) = acting, red (0xff4444) = being hit.
   * Returns a Promise so callers can await it.
   */
  blinkEnemy(color = 0xffffff) {
    return new Promise(resolve => {
      // setTintFill fills the sprite entirely with the color,
      // making the flash visible regardless of the sprite's base color.
      this.enemySprite.setTintFill(color);
      this.time.delayedCall(150, () => {
        this.enemySprite.clearTint();
        resolve();
      });
    });
  }

  /**
   * Flashes a party member's row highlight and name text.
   * white = acting, red (0xff4444 / '#ff4444') = being hit.
   */
  blinkPartyMember(index, color = 0xffffff, textColor = '#ffffff') {
    return new Promise(resolve => {
      const highlight = this.partyRowHighlights[index];
      const nameTxt   = this.partyNameTexts[index];
      const sprite    = this.partySprites[index];
      if (!highlight || !nameTxt) { resolve(); return; }

      highlight.setFillStyle(color, 0.35);
      nameTxt.style.color = textColor;
      if (sprite) sprite.setAlpha(0.4); // dim sprite during flash

      this.time.delayedCall(150, () => {
        highlight.setFillStyle(0xffffff, 0);
        nameTxt.style.color = '#ffffff';
        if (sprite) sprite.setAlpha(1);
        resolve();
      });
    });
  }

  // ── INPUT PHASE ──────────────────────────────────────────────────────────────

  currentInputMember() { return this.party[this.currentInputIndex]; }

  startInputPhase() {
    if (this.battleState === 'WON' || this.battleState === 'LOST') return;
    this.battleState = 'INPUT_PHASE';
    this.actionQueue = [];
    this.currentInputIndex = 0;
    this.advanceToNextInput();
  }

  advanceToNextInput() {
    while (
      this.currentInputIndex < this.party.length &&
      this.party[this.currentInputIndex].hp <= 0
    ) { this.currentInputIndex++; }

    if (this.currentInputIndex >= this.party.length) {
      domText.setText(this.activeCharIndicatorEl, '');
      this.startExecutionPhase();
      return;
    }

    const member = this.currentInputMember();
    domText.setText(this.messageTextEl, `${member.name}'s turn!`);
    domText.setText(this.activeCharIndicatorEl, `▶ ${member.name}`);
    this.openMainMenu();
  }

  queueAction(action) {
    this.actionQueue.push({
      actorType: 'party',
      partyIndex: this.currentInputIndex,
      action,
    });
    this.currentInputIndex++;
    this.clearMenu();
    this.advanceToNextInput();
  }

  // ── EXECUTION PHASE ──────────────────────────────────────────────────────────

  startExecutionPhase() {
    this.battleState = 'EXECUTING';

    const enemyAbility = EditorData.selectAbility(this.enemy.abilities);
    this.actionQueue.push({
      actorType: 'enemy',
      partyIndex: null,
      action: { type: 'ability', ability: enemyAbility },
    });

    const actorsWithSpeed = this.actionQueue.map(entry => {
      const speed = entry.actorType === 'enemy'
        ? this.enemy.speed
        : (GameState.getEffectiveStats(this.party[entry.partyIndex]).speed || 10);
      return { ...entry, speed };
    });
    actorsWithSpeed.sort((a, b) => b.speed - a.speed);

    this.executeNext(actorsWithSpeed, 0);
  }

  executeNext(turnOrder, index) {
    if (index >= turnOrder.length) { this.endOfRound(); return; }
    const entry = turnOrder[index];
    const next  = () => this.executeNext(turnOrder, index + 1);

    if (entry.actorType === 'enemy') {
      this.executeEnemyAction(entry.action.ability, next);
    } else {
      const member = this.party[entry.partyIndex];
      if (member.hp <= 0) { next(); return; }
      this.executePartyAction(member, entry.action, next);
    }
  }

  executePartyAction(member, action, next) {
    const memberIndex = this.party.indexOf(member);

    if (action.type === 'attack') {
      // Attacker blinks white, then deal damage and blink enemy red.
      this.blinkPartyMember(memberIndex, 0xffffff, '#ffffff').then(() => {
        const stats = GameState.getEffectiveStats(member);
        const raw   = this.randomInRange(stats.attackMin, stats.attackMax);
        const result = this.dealDamageToEnemy(raw);
        this.updateBars();
        domText.setText(this.messageTextEl,
          `${member.name} attacks for ${this.formatDamageText(result)}!`);
        this.blinkEnemy(0xff4444).then(() => {
          if (this.enemy.hp <= 0) { this.time.delayedCall(1000, () => this.triggerVictory()); return; }
          this.time.delayedCall(800, next);
        });
      });

    } else if (action.type === 'spell') {
      this.executePartySpell(member, action.spell, action.targetIndex, next);

    } else if (action.type === 'defend') {
      member.defending = true;
      domText.setText(this.messageTextEl, `${member.name} defends!`);
      this.time.delayedCall(600, next);

    } else if (action.type === 'flee') {
      if (Math.random() < 0.5) {
        domText.setText(this.messageTextEl, 'Got away safely!');
        this.time.delayedCall(800, () => this.returnToMap());
      } else {
        domText.setText(this.messageTextEl, 'Could not escape!');
        this.time.delayedCall(800, next);
      }
    }
  }

  executePartySpell(member, spell, targetIndex, next) {
    const memberIndex = this.party.indexOf(member);

    if (member.mp < spell.cost) {
      domText.setText(this.messageTextEl, `${member.name} doesn't have enough MP!`);
      this.time.delayedCall(800, next);
      return;
    }

    // Attacker blinks white before the spell resolves.
    this.blinkPartyMember(memberIndex, 0xffffff, '#ffffff').then(() => {
      member.mp -= spell.cost;

    if (spell.type === 'offense') {
      const raw = this.randomInRange(spell.min, spell.max);
      const result = this.dealDamageToEnemy(raw);
      this.updateBars();
      domText.setText(this.messageTextEl,
        `${member.name} casts ${spell.name} for ${this.formatDamageText(result)}!`);
      if (this.enemy.hp <= 0) { this.time.delayedCall(1000, () => this.triggerVictory()); return; }
      this.time.delayedCall(800, next);

    } else if (spell.type === 'heal') {
      const target = this.party[targetIndex ?? 0];
      const amt    = this.randomInRange(spell.min, spell.max);
      target.hp    = Math.min(target.maxHp, target.hp + amt);
      this.updateBars();
      domText.setText(this.messageTextEl,
        `${member.name} casts ${spell.name} on ${target.name} for ${amt} HP!`);
      this.time.delayedCall(800, next);

    } else if (spell.type === 'drain') {
      const stats  = GameState.getEffectiveStats(member);
      const rolled = this.randomInRange(stats.attackMin, stats.attackMax);
      const raw    = Math.round(rolled * spell.multiplier);
      const result = this.dealDamageToEnemy(raw);
      const heal   = Math.round(result.finalDamage * spell.selfHealPercent);
      member.hp    = Math.min(member.maxHp, member.hp + heal);
      this.updateBars();
      domText.setText(this.messageTextEl,
        `${member.name} casts ${spell.name} for ${this.formatDamageText(result)}, heals ${heal} HP!`);
      if (this.enemy.hp <= 0) { this.time.delayedCall(1000, () => this.triggerVictory()); return; }
      this.time.delayedCall(800, next);

    } else if (spell.type === 'attackMultiplier') {
      const stats  = GameState.getEffectiveStats(member);
      const rolled = this.randomInRange(stats.attackMin, stats.attackMax);
      const raw    = Math.round(rolled * spell.multiplier);
      const result = this.dealDamageToEnemy(raw);
      this.updateBars();
      domText.setText(this.messageTextEl,
        `${member.name} casts ${spell.name} for ${this.formatDamageText(result)}!`);
      if (this.enemy.hp <= 0) { this.time.delayedCall(1000, () => this.triggerVictory()); return; }
      this.time.delayedCall(800, next);

    } else if (spell.type === 'debuff') {
      this.enemy.exposeWeaknessTurns = spell.durationTurns;
      domText.setText(this.messageTextEl,
        `${member.name} casts ${spell.name}! ${this.enemy.name} is exposed!`);
      this.updateBars();
      this.time.delayedCall(800, next);
    }
    }); // close blinkPartyMember .then()
  }

  // ── ENEMY ACTIONS ─────────────────────────────────────────────────────────────

  executeEnemyAction(ability, next) {
    const living = this.party.filter(m => m.hp > 0);
    if (!living.length) { next(); return; }

    // Positional weighting: front slot targeted most.
    const weights = [30, 25, 20, 15, 10];
    const total   = living.reduce((s, m) => s + (weights[this.party.indexOf(m)] || 5), 0);
    let roll = Math.random() * total;
    let target = living[living.length - 1];
    for (const m of living) {
      roll -= (weights[this.party.indexOf(m)] || 5);
      if (roll <= 0) { target = m; break; }
    }

    const abilityType = ability ? (ability.type || 'attack') : 'attack';
    const params      = (ability && ability.params) ? ability.params : {};

    // checkWipe: called after each ability resolves. If the party is
    // wiped, triggers Game Over. Otherwise calls next() to continue
    // the turn order. This runs INSIDE the resolve methods (after
    // damage is applied) rather than here synchronously, because all
    // resolve methods now run asynchronously inside .then() callbacks
    // after the blink — so checking HP here would always see
    // pre-damage values and never detect a wipe.
    const checkWipe = () => {
      if (this.party.every(m => m.hp <= 0)) {
        this.battleState = 'LOST';
        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 0, 0, 0);
          domText.fadeOut();
          this.cameras.main.once('camerafadeoutcomplete', () => {
            domText.clearAll();
            this.scene.start('GameOverScene');
          });
        });
      } else {
        this.time.delayedCall(800, next);
      }
    };

    if      (abilityType === 'heal')   this.blinkEnemy(0xffffff).then(() => { this.resolveEnemyHeal(ability, params);              this.time.delayedCall(800, next); });
    else if (abilityType === 'drain')  this.resolveEnemyDrain(ability, params, target, checkWipe);
    else if (abilityType === 'debuff') this.blinkEnemy(0xffffff).then(() => { this.resolveEnemyDebuff(ability, params, target);    this.time.delayedCall(800, next); });
    else if (abilityType === 'buff')   this.blinkEnemy(0xffffff).then(() => { this.resolveEnemyBuff(ability, params);              this.time.delayedCall(800, next); });
    else                               this.resolveEnemyAttack(ability, params, target, checkWipe);
  }

  resolveEnemyAttack(ability, params, target, checkWipe) {
    const targetIndex = this.party.indexOf(target);
    this.blinkEnemy(0xffffff).then(() => {
      const ts  = GameState.getEffectiveStats(target);
      const es  = this.getEnemyEffectiveStats();
      const mul = params.damageMultiplier || 1.0;
      let dmg   = Math.round(this.randomInRange(es.attackMin, es.attackMax) * mul);
      if (target.defending) dmg = Math.floor(dmg / 2);
      dmg = Math.max(1, dmg - ts.defense);
      target.hp = Math.max(0, target.hp - dmg);
      this.updateBars();
      const msg = (params.message || '{name} attacks {target} for {damage} damage!')
        .replace(/{name}/g, this.enemy.name)
        .replace(/{target}/g, target.name)
        .replace(/{damage}/g, dmg);
      domText.setText(this.messageTextEl, msg);
      this.blinkPartyMember(targetIndex, 0xff4444, '#ff4444').then(() => checkWipe());
    });
  }

  resolveEnemyHeal(ability, params) {
    const amt = this.randomInRange(params.minAmount || 5, params.maxAmount || 10);
    this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + amt);
    this.updateBars();
    const msg = (params.message || '{name} heals for {amount} HP!')
      .replace(/{name}/g, this.enemy.name).replace(/{amount}/g, amt);
    domText.setText(this.messageTextEl, msg);
  }

  resolveEnemyDrain(ability, params, target, checkWipe) {
    const targetIndex = this.party.indexOf(target);
    this.blinkEnemy(0xffffff).then(() => {
      const ts  = GameState.getEffectiveStats(target);
      const es  = this.getEnemyEffectiveStats();
      let dmg   = Math.round(this.randomInRange(es.attackMin, es.attackMax) * (params.damageMultiplier || 1.0));
      if (target.defending) dmg = Math.floor(dmg / 2);
      dmg = Math.max(1, dmg - ts.defense);
      target.hp = Math.max(0, target.hp - dmg);
      const heal = Math.round(dmg * (params.selfHealPercent || 0.2));
      this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + heal);
      this.updateBars();
      const msg = (params.message || '{name} drains {target} for {damage} damage, healing {amount} HP!')
        .replace(/{name}/g, this.enemy.name).replace(/{target}/g, target.name)
        .replace(/{damage}/g, dmg).replace(/{amount}/g, heal);
      domText.setText(this.messageTextEl, msg);
      this.blinkPartyMember(targetIndex, 0xff4444, '#ff4444').then(() => checkWipe());
    });
  }

  resolveEnemyDebuff(ability, params, target) {
    const stat = params.stat || 'attackMin';
    const existing = (target.activeDebuffs || []).find(d => d.stat === stat);
    if (existing) { existing.turnsRemaining = (params.durationTurns || 3) + 1; }
    else {
      target.activeDebuffs = target.activeDebuffs || [];
      target.activeDebuffs.push({ stat, amount: params.amount || 2, turnsRemaining: (params.durationTurns || 3) + 1 });
    }
    const msg = (params.message || '{name} weakens {target}!')
      .replace(/{name}/g, this.enemy.name).replace(/{target}/g, target.name);
    domText.setText(this.messageTextEl, msg);
  }

  resolveEnemyBuff(ability, params) {
    const stat = params.stat || 'attackMin';
    const existing = (this.enemy.activeBuffs || []).find(b => b.stat === stat);
    if (existing) { existing.turnsRemaining = (params.durationTurns || 3) + 1; }
    else {
      this.enemy.activeBuffs = this.enemy.activeBuffs || [];
      this.enemy.activeBuffs.push({ stat, amount: params.amount || 2, turnsRemaining: (params.durationTurns || 3) + 1 });
    }
    const msg = (params.message || '{name} enrages!').replace(/{name}/g, this.enemy.name);
    domText.setText(this.messageTextEl, msg);
  }

  // ── END OF ROUND ──────────────────────────────────────────────────────────────

  endOfRound() {
    // Guard: if the battle ended mid-round (win or loss), don't
    // process status effects or start a new input phase.
    if (this.battleState === 'WON' || this.battleState === 'LOST') return;

    this.party.forEach(m => { m.defending = false; });
    const msgs = [];

    if (this.enemy.exposeWeaknessTurns > 0) {
      this.enemy.exposeWeaknessTurns -= 1;
      const r = this.enemy.exposeWeaknessTurns;
      msgs.push(r > 0
        ? `${this.enemy.name} is Exposed (${r} turn${r === 1 ? '' : 's'} left).`
        : `${this.enemy.name}'s weakness fades.`);
    }

    this.enemy.activeBuffs = (this.enemy.activeBuffs || []).filter(b => {
      b.turnsRemaining -= 1;
      if (b.turnsRemaining <= 0) { msgs.push(`${this.enemy.name}'s power returns to normal.`); return false; }
      msgs.push(`${this.enemy.name} is enraged (${b.turnsRemaining} turn${b.turnsRemaining === 1 ? '' : 's'} left).`);
      return true;
    });

    this.party.forEach(m => {
      m.activeDebuffs = (m.activeDebuffs || []).filter(d => {
        d.turnsRemaining -= 1;
        if (d.turnsRemaining <= 0) { msgs.push(`${m.name}'s strength returns to normal.`); return false; }
        msgs.push(`${m.name} is weakened (${d.turnsRemaining} turn${d.turnsRemaining === 1 ? '' : 's'} left).`);
        return true;
      });
    });

    let delay = 0;
    msgs.forEach((msg, i) => {
      this.time.delayedCall(i * 800, () => domText.setText(this.messageTextEl, msg));
      delay = (i + 1) * 800;
    });
    this.time.delayedCall(delay, () => this.startInputPhase());
  }

  // ── VICTORY ───────────────────────────────────────────────────────────────────

  triggerVictory() {
    this.battleState = 'WON';
    const levelUpMessages = [];
    this.party.forEach(member => {
      const result = GameState.awardXp(member, this.enemy.xpReward);
      if (result.levelUps > 0) {
        const g = result.statGains;
        levelUpMessages.push(
          `${member.name} is now level ${result.newLevel}! (+${g.maxHp} HP, +${g.maxMp} MP, +${g.attackMin}/+${g.attackMax} Attack)`
        );
      }
    });

    const dropped = this.enemy.dropPool
      ? GameState.rollForDropFromPool(this.enemy.dropPool, this.enemy.dropChance)
      : GameState.rollForDrop();

    SaveSystem.saveToSlot(SaveSystem.AUTO_SAVE_SLOT);

    domText.setText(this.messageTextEl, `${this.enemy.name} defeated!`);
    this.time.delayedCall(1000, () => {
      domText.setText(this.messageTextEl, `Party earned ${this.enemy.xpReward} XP each!`);
    });

    let next = 2200;
    if (dropped) {
      this.time.delayedCall(next, () => domText.setText(this.messageTextEl, `Found a ${dropped}!`));
      next += 1800;
    }
    levelUpMessages.forEach(msg => {
      this.time.delayedCall(next, () => domText.setText(this.messageTextEl, msg));
      next += 1800;
    });
    this.time.delayedCall(next, () => this.returnToMap());
  }

  // ── MENU SYSTEM ───────────────────────────────────────────────────────────────

  clearMenu() {
    this.menuTexts.forEach(el => domText.remove(el));
    this.menuTexts = [];
    if (this.menuCursorEl) { domText.remove(this.menuCursorEl); this.menuCursorEl = null; }
    this.menuStack = [];
  }

  renderMenu(options) {
    this.menuTexts.forEach(el => domText.remove(el));
    if (this.menuCursorEl) domText.remove(this.menuCursorEl);
    this.currentMenuOptions = options;
    this.selectedIndex = 0;
    this.menuTexts = options.map((opt, i) =>
      domText.create(40, this.menuCursorBaseY + i * 13, opt.label, {
        fontSize: 12,
        color: opt.disabled ? '#555577' : '#e0e0ff',
        align: 'left',
      })
    );
    this.menuCursorEl = domText.create(22, this.menuCursorBaseY, '▶', {
      fontSize: 11, color: '#ffff44', align: 'left',
    });
    this.updateMenuCursorPosition();
  }

  updateMenuCursorPosition() {
    this.menuCursorEl.style.top =
      `${(this.menuCursorBaseY + this.selectedIndex * 13) * domText.ZOOM}px`;
  }

  openMainMenu() {
    this.menuStack = [];
    this.renderMenu([
      { label: 'Attack', action: () => this.queueAction({ type: 'attack' }) },
      { label: 'Magic',  action: () => this.openSpellMenu() },
      { label: 'Defend', action: () => this.queueAction({ type: 'defend' }) },
      { label: 'Flee',   action: () => this.queueAction({ type: 'flee' }) },
    ]);
  }

  openSpellMenu() {
    this.menuStack.push(() => this.openMainMenu());
    const member = this.currentInputMember();
    this.renderMenu(member.spells.map(spell => ({
      label: `${spell.name} (${spell.cost} MP)`,
      disabled: member.mp < spell.cost,
      action: () => {
        if (member.mp < spell.cost) {
          domText.setText(this.messageTextEl, 'Not enough MP!');
          return;
        }
        this.queueSpell(spell);
      },
    })));
  }

  queueSpell(spell) {
    if (spell.type === 'heal') { this.openTargetMenu(spell); }
    else { this.queueAction({ type: 'spell', spell, targetIndex: null }); }
  }

  openTargetMenu(spell) {
    this.menuStack.push(() => this.openSpellMenu());
    const living = this.party.filter(m => m.hp > 0);
    this.renderMenu(living.map(member => ({
      label: member.name,
      action: () => this.queueAction({ type: 'spell', spell, targetIndex: this.party.indexOf(member) }),
    })));
  }

  // ── INPUT HANDLER ─────────────────────────────────────────────────────────────

  update() {
    if (this.battleState !== 'INPUT_PHASE') return;
    if (!this.currentMenuOptions.length)    return;

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selectedIndex = (this.selectedIndex - 1 + this.currentMenuOptions.length) % this.currentMenuOptions.length;
      this.updateMenuCursorPosition();
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selectedIndex = (this.selectedIndex + 1) % this.currentMenuOptions.length;
      this.updateMenuCursorPosition();
    } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      const opt = this.currentMenuOptions[this.selectedIndex];
      if (!opt.disabled) opt.action();
    } else if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      if (this.menuStack.length > 0) {
        // Inside a sub-menu (spell list, target select) — step back one level.
        this.menuStack.pop()();
      } else if (this.actionQueue.length > 0) {
        // On the main menu with queued actions — undo the last queued action
        // and go back to that character's input turn.
        const last = this.actionQueue.pop();
        this.currentInputIndex = last.partyIndex;
        const member = this.currentInputMember();
        domText.setText(this.messageTextEl, `${member.name}'s turn!`);
        domText.setText(this.activeCharIndicatorEl, `▶ ${member.name}`);
        this.openMainMenu();
      }
      // If no sub-menus and no queued actions, Escape does nothing
      // (we're already at the first character's input).
    }
  }

  // ── NAVIGATION ────────────────────────────────────────────────────────────────

  returnToMap() {
    this.party.forEach(m => { m.activeDebuffs = []; });
    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('MapScene');
    });
  }
}
