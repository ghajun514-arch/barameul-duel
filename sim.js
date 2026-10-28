'use strict';
// 서버 권한형 1대1 결투 시뮬레이션. 모든 판정은 여기서만 일어난다.
// 단위는 롤과 같은 게임 거리 단위(사거리 450 = 450)를 그대로 쓴다.

const ARENA = { w: 2800, h: 1800 };
const VISION = 1150;          // 챔피언 시야 반경
const HAWK_VISION = 950;

// 1대1용으로 '중반(11레벨, 코어 2개)' 수준으로 고정한 스탯
const CHAMPS = {
  wind:  { key: 'wind',  name: '질풍검객', hp: 1750, ad: 150, bonusAd: 75, as: 1.10, baseAs: 0.697, range: 175, armor: 72, mr: 46, ms: 345, crit: 0.5,  critMul: 1.575, ranged: false, radius: 34 },
  soul:  { key: 'soul',  name: '망령검객', hp: 1720, ad: 148, bonusAd: 72, as: 1.08, baseAs: 0.625, range: 175, armor: 70, mr: 46, ms: 345, crit: 0.5,  critMul: 1.575, ranged: false, radius: 34 },
  frost: { key: 'frost', name: '서리궁수', hp: 1600, ad: 152, bonusAd: 72, as: 1.05, baseAs: 0.658, range: 600, armor: 58, mr: 40, ms: 330, crit: 0.25, critMul: 1.75,  ranged: true,  radius: 32, mana: 700, manaRegen: 9 },
};
const CD = {
  wind:  { Q: 4, W: 21, E: 0.5, R: 40, F: 60 },
  soul:  { Q: 4, W: 14, E: 16,  R: 60, F: 60 },
  frost: { Q: 0, W: 11, E: 5,   R: 60, F: 60 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const lerp = (a, b, k) => a + (b - a) * k;

function segPointDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let k = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  k = clamp(k, 0, 1);
  return hyp(px - (ax + dx * k), py - (ay + dy * k));
}
function segIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
  if (!d) return false;
  const u = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
  const v = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

class Game {
  constructor(players, opts = {}) {
    this.t = 0;
    this.practice = !!opts.practice;
    this.target = opts.rounds || 3;
    this.nextId = 1;
    this.score = [0, 0];
    this.round = 0;
    this.fx = [];
    this.over = false;
    this.winner = -1;
    this.champs = players.map((p, i) => this.makeChamp(i, p));
    this.startRound();
  }

  // ───────────────────────── 생성 / 리셋
  makeChamp(slot, p) {
    const d = CHAMPS[p.champ] || CHAMPS.wind;
    return { slot, key: d.key, d, name: p.name || d.name, bot: !!p.bot };
  }
  spawnPoint(slot) {
    return { x: ARENA.w / 2 + (slot === 0 ? -700 : 700), y: ARENA.h / 2 };
  }
  resetChamp(c) {
    const sp = this.spawnPoint(c.slot);
    Object.assign(c, {
      x: sp.x, y: sp.y, lx: sp.x, ly: sp.y, facing: c.slot === 0 ? 0 : Math.PI,
      hp: c.d.hp, mana: c.d.mana || 0, dead: false, respawnAt: 0,
      moveT: null, attacking: false, aaCd: 0, aaWind: null, cast: null, queued: null, dash: null,
      cds: { Q: 0, W: 0, E: 0, R: 0, F: 0 },
      airUntil: 0, airDur: 0, stunUntil: 0, stunDur: 0, slow: null, shields: [], unstoppableUntil: 0, ultUntil: 0,
      qStacks: 0, qStackUntil: 0, flow: 0, aaCount: 0, eStacks: 0, eStackUntil: 0, eLockUntil: 0,
      armorPenUntil: 0, asBuffUntil: 0, focus: 0, focusTick: 0, hawkCharges: 2, hawkRecharge: 0,
      spirit: null, revealUntil: 0, lastHurt: -99, botNext: 0,
    });
  }
  startRound() {
    this.round++;
    this.projs = [];
    this.walls = [];
    this.hawks = [];
    for (const c of this.champs) this.resetChamp(c);
    this.phase = 'countdown';
    this.phaseUntil = this.t + (this.round === 1 ? 4 : 3);
    this.fx.push({ k: 'round', n: this.round });
  }

  // ───────────────────────── 공용 도우미
  enemy(c) { return this.champs[1 - c.slot]; }
  isAir(c) { return this.t < c.airUntil; }
  isCC(c) { return this.t < c.airUntil || this.t < c.stunUntil || this.t < c.ultUntil; }
  qRed(c) { return clamp((c.d.as / c.d.baseAs - 1) / 1.67, 0, 0.66); }
  as(c) { return c.d.as * (this.t < c.asBuffUntil ? 1.4 : 1); }
  ms(c) {
    let m = c.d.ms;
    if (c.slow && this.t < c.slow.until) m *= 1 - c.slow.pct;
    if (c.spirit) m *= 1.1 + 0.2 * Math.min(1, (this.t - c.spirit.start) / 5);
    return m;
  }
  clampPos(c) {
    const r = c.d.radius;
    c.x = clamp(c.x, r, ARENA.w - r);
    c.y = clamp(c.y, r, ARENA.h - r);
  }
  sees(viewer, target) {
    if (viewer === target) return true;
    if (target.dead) return true;
    if (hyp(viewer.x - target.x, viewer.y - target.y) <= VISION) return true;
    if (viewer.spirit && hyp(viewer.spirit.bx - target.x, viewer.spirit.by - target.y) <= VISION * 0.6) return true;
    if (this.t < target.revealUntil) return true;
    for (const h of this.hawks) {
      if (h.owner === viewer.slot && hyp(h.x - target.x, h.y - target.y) <= HAWK_VISION) return true;
    }
    return false;
  }
  aimDir(c, tx, ty) {
    let dx = tx - c.x, dy = ty - c.y;
    const l = hyp(dx, dy);
    if (l < 1) return { x: Math.cos(c.facing), y: Math.sin(c.facing) };
    return { x: dx / l, y: dy / l };
  }
  crit(c) { return Math.random() < c.d.crit; }
  setSlow(c, pct, dur) {
    if (!c.slow || this.t >= c.slow.until || pct >= c.slow.pct) c.slow = { pct, until: this.t + dur };
  }
  knockup(e, dur) {
    if (this.t < e.unstoppableUntil || e.dead) return false;
    e.airUntil = Math.max(e.airUntil, this.t + dur);
    e.airDur = e.airUntil - this.t;
    this.interrupt(e);
    return true;
  }
  stun(e, dur) {
    if (this.t < e.unstoppableUntil || e.dead) return false;
    e.stunUntil = Math.max(e.stunUntil, this.t + dur);
    e.stunDur = dur;
    this.interrupt(e);
    return true;
  }
  interrupt(e) {
    e.aaWind = null;
    if (e.cast && !e.cast.uncancel) e.cast = null;
    if (e.dash && !e.dash.uncancel) e.dash = null;
  }

  deal(src, tgt, amount, type, opts = {}) {
    if (!tgt || tgt.dead || amount <= 0) return 0;
    let a = amount;
    if (type === 'phys') {
      let arm = tgt.d.armor;
      if (opts.armorIgnore) arm = Math.max(0, arm - opts.armorIgnore);
      a *= 100 / (100 + arm);
    } else if (type === 'magic') {
      a *= 100 / (100 + tgt.d.mr);
    }
    // 질풍검객 패시브: 기류가 가득 차 있으면 챔피언에게 맞을 때 보호막
    if (tgt.key === 'wind' && tgt.flow >= 1 && src && src !== tgt) {
      tgt.flow = 0;
      tgt.shields.push({ v: 450, until: this.t + 1 });
      this.fx.push({ k: 'flowshield', s: tgt.slot });
    }
    let left = a;
    for (const s of tgt.shields) {
      if (left <= 0) break;
      const take = Math.min(s.v, left);
      s.v -= take;
      left -= take;
    }
    tgt.shields = tgt.shields.filter(s => s.v > 0.5);
    tgt.hp -= left;
    tgt.lastHurt = this.t;
    if (src && src !== tgt) {
      src.revealUntil = Math.max(src.revealUntil, this.t + 1.2);
      // 망령검객 혼 이탈: 이탈 중에 준 피해를 쌓아둔다
      if (src.key === 'soul' && src.spirit && type !== 'true') src.spirit.store += a;
    }
    this.fx.push({ k: 'dmg', x: Math.round(tgt.x), y: Math.round(tgt.y), v: Math.round(a), ty: type, cr: !!opts.crit, s: tgt.slot });
    return a;
  }

  // ───────────────────────── 입력
  input(slot, m) {
    const c = this.champs[slot];
    if (!c || !m || typeof m !== 'object') return;
    if (c.dead || this.phase !== 'fight') return;
    const x = Number(m.x), y = Number(m.y);
    const hasXY = Number.isFinite(x) && Number.isFinite(y);
    switch (m.type) {
      case 'move':
        if (!hasXY) return;
        if (c.cast || c.dash) { c.queued = { type: 'move', x, y }; return; }
        c.moveT = { x: clamp(x, 0, ARENA.w), y: clamp(y, 0, ARENA.h) };
        c.attacking = false;
        c.aaWind = null;
        break;
      case 'attack':
        if (c.cast || c.dash) { c.queued = { type: 'attack' }; return; }
        c.attacking = true;
        c.moveT = null;
        break;
      case 'stop':
        c.moveT = null; c.attacking = false; c.aaWind = null; c.queued = null;
        break;
      case 'cast':
        if (!hasXY || !['Q', 'W', 'E', 'R', 'F'].includes(m.key)) return;
        this.cast(c, m.key, x, y);
        break;
    }
  }

  runQueued(c) {
    const q = c.queued;
    c.queued = null;
    if (!q) return;
    if (q.type === 'move') { c.moveT = { x: q.x, y: q.y }; c.attacking = false; }
    else if (q.type === 'attack') { c.attacking = true; c.moveT = null; }
    else if (q.type === 'cast') this.cast(c, q.key, q.x, q.y);
  }

  cast(c, key, tx, ty) {
    if (c.dead) return;
    if (key === 'F') return this.flash(c, tx, ty);

    // 망령검객: 혼 이탈 중 E 재사용 = 복귀
    if (c.key === 'soul' && key === 'E' && c.spirit) {
      if (!this.isCC(c) && !c.dash && this.t - c.spirit.start > 0.4) this.soulReturn(c);
      return;
    }
    // 질풍검객: 돌진 중 Q = 원형 베기(EQ)
    if (c.key === 'wind' && key === 'Q' && c.dash && c.dash.kind === 'windE') {
      if (c.cds.Q <= 0 && !c.dash.eq) { c.dash.eq = true; c.cds.Q = this.windQcd(c); }
      return;
    }
    if (this.isCC(c)) return;
    if (c.cast || c.dash) { c.queued = { type: 'cast', key, x: tx, y: ty }; return; }
    if (c.cds[key] > 0) return;

    const fn = SKILLS[c.key][key];
    if (fn) fn.call(this, c, tx, ty);
  }

  startCast(c, key, windup, fire, extra = {}) {
    c.cast = Object.assign({ key, t: 0, w: Math.max(0.01, windup), fire }, extra);
    c.aaWind = null;
  }

  flash(c, tx, ty) {
    if (c.cds.F > 0 || this.isCC(c)) return;
    const d = this.aimDir(c, tx, ty);
    const len = Math.min(400, hyp(tx - c.x, ty - c.y));
    const ox = c.x, oy = c.y;
    c.x += d.x * len; c.y += d.y * len;
    this.clampPos(c);
    const mx = c.x - ox, my = c.y - oy;
    if (c.dash) { c.dash.sx += mx; c.dash.sy += my; c.dash.ex += mx; c.dash.ey += my; }
    c.cds.F = CD[c.key].F;
    c.facing = Math.atan2(d.y, d.x);
    this.fx.push({ k: 'flash', x1: Math.round(ox), y1: Math.round(oy), x2: Math.round(c.x), y2: Math.round(c.y) });
  }

  // ───────────────────────── 질풍검객 도우미
  windQcd(c) { return Math.max(1.33, CD.wind.Q * (1 - this.qRed(c))); }
  windQdmg(c) {
    const cr = this.crit(c);
    return { v: (70 + 1.05 * c.d.ad) * (cr ? c.d.critMul : 1), cr };
  }
  windArmorIgnore(c, e, cr) {
    if (!cr || this.t >= c.armorPenUntil) return 0;
    return 0.6 * Math.max(0, e.d.armor - 30);
  }
  addQStack(c) {
    c.qStacks = Math.min(2, c.qStacks + 1);
    c.qStackUntil = this.t + 6;
  }
  canWindUlt(c) {
    const e = this.enemy(c);
    return !!e && !e.dead && this.isAir(e) && this.sees(c, e) && hyp(e.x - c.x, e.y - c.y) <= 1400 && c.cds.R <= 0;
  }

  soulReturn(c) {
    const s = c.spirit;
    c.spirit = null;
    const e = this.enemy(c);
    if (s.store > 1 && e && !e.dead) {
      this.deal(c, e, s.store * 0.3, 'true', { mark: true });
      this.fx.push({ k: 'soulmark', x: Math.round(e.x), y: Math.round(e.y) });
    }
    c.cast = null; c.aaWind = null; c.attacking = false; c.moveT = null;
    const d = hyp(s.bx - c.x, s.by - c.y);
    c.dash = { kind: 'soulReturn', sx: c.x, sy: c.y, ex: s.bx, ey: s.by, t: 0, dur: Math.max(0.12, d / 1500), uncancel: true, ghost: true };
    c.unstoppableUntil = this.t + c.dash.dur + 0.05;
    c.cds.E = CD.soul.E;
    this.fx.push({ k: 'soulback', s: c.slot });
  }

  // ───────────────────────── 기본 공격
  doAttack(c, e) {
    if (c.d.ranged) {
      // 서리궁수: 치명타는 피해 대신 기댓값으로 고정 증폭, 치명타 시 둔화 2배
      const buffed = this.t < c.asBuffUntil;
      const base = c.d.ad * (1 + c.d.crit * (c.d.critMul - 1)) * (buffed ? 1.2 : 1);
      if (!buffed) { c.focus = Math.min(4, c.focus + 1); c.focusTick = this.t + 4; }
      const n = buffed ? 5 : 1;
      for (let i = 0; i < n; i++) {
        const spread = n > 1 ? (i - 2) * 0.09 : 0;
        const ang = c.facing + spread;
        this.projs.push({
          id: this.nextId++, kind: 'arrow', owner: c.slot, x: c.x + Math.cos(ang) * 30, y: c.y + Math.sin(ang) * 30,
          ang, speed: 2000, homing: e.slot, curve: spread, life: 1.2, dist: 0,
          onHit: (g, tgt) => {
            const cr = Math.random() < c.d.crit;
            g.deal(c, tgt, base / n, 'phys');
            g.setSlow(tgt, cr ? 0.5 : 0.25, 2);
          },
        });
      }
      this.fx.push({ k: 'shoot', s: c.slot });
      return;
    }
    const cr = this.crit(c);
    let v = c.d.ad * (cr ? c.d.critMul : 1);
    c.aaCount++;
    if (c.key === 'soul' && c.aaCount % 2 === 0) {
      this.deal(c, e, v / 2, 'phys', { crit: cr });
      this.deal(c, e, v / 2, 'magic', { crit: cr });
      this.fx.push({ k: 'swing', s: c.slot, a: +c.facing.toFixed(2), alt: 1 });
    } else {
      this.deal(c, e, v, 'phys', { crit: cr, armorIgnore: c.key === 'wind' ? this.windArmorIgnore(c, e, cr) : 0 });
      this.fx.push({ k: 'swing', s: c.slot, a: +c.facing.toFixed(2) });
    }
  }

  // ───────────────────────── 틱
  tick(dt) {
    this.t += dt;
    if (this.phase === 'countdown') {
      if (this.t >= this.phaseUntil) { this.phase = 'fight'; this.fx.push({ k: 'fight' }); }
      return;
    }
    if (this.phase === 'roundEnd') {
      if (this.t >= this.phaseUntil) {
        if (this.over) this.phase = 'over';
        else this.startRound();
      }
      return;
    }
    if (this.phase !== 'fight') return;

    for (const c of this.champs) this.updateChamp(c, dt);
    this.updateProjs(dt);
    this.walls = this.walls.filter(w => this.t < w.until);
    this.updateHawks(dt);
    this.separate();
    this.checkDeaths();
  }

  updateChamp(c, dt) {
    const t = this.t;
    if (c.dead) {
      if (this.practice && c.respawnAt && t >= c.respawnAt) {
        this.resetChamp(c);
        this.fx.push({ k: 'respawn', s: c.slot });
      }
      return;
    }
    if (c.d.mana) c.mana = Math.min(c.d.mana, c.mana + c.d.manaRegen * dt);
    for (const k in c.cds) if (c.cds[k] > 0) c.cds[k] = Math.max(0, c.cds[k] - dt);
    if (c.aaCd > 0) c.aaCd -= dt;
    c.shields = c.shields.filter(s => t < s.until);
    if (c.qStacks && t > c.qStackUntil) c.qStacks = 0;
    if (c.eStacks && t > c.eStackUntil) c.eStacks = 0;
    if (c.focus > 0 && t > c.focusTick) { c.focus--; c.focusTick = t + 1; }
    if (c.key === 'frost' && c.hawkCharges < 2) {
      c.hawkRecharge -= dt;
      if (c.hawkRecharge <= 0) { c.hawkCharges++; c.hawkRecharge = c.hawkCharges < 2 ? 35 : 0; }
    }
    if (c.bot) this.botThink(c);

    // 혼 이탈 시간 만료 → 복귀 (강한 군중 제어 중에는 연장)
    if (c.spirit && t >= c.spirit.until && !this.isCC(c) && !c.dash) this.soulReturn(c);

    if (c.dash) {
      this.updateDash(c, dt);
    } else if (c.cast && (c.cast.uncancel || !this.isCC(c))) {
      c.cast.t += dt;
      if (c.cast.t >= c.cast.w) {
        const cs = c.cast;
        c.cast = null;
        cs.fire.call(this, c, cs);
        if (!c.cast && !c.dash) this.runQueued(c);
      }
    } else if (this.isCC(c)) {
      c.aaWind = null;
      c.cast = null;
    } else {
      this.updateAttackMove(c, dt);
    }

    // 질풍검객: 움직인 거리만큼 기류
    const moved = hyp(c.x - c.lx, c.y - c.ly);
    if (c.key === 'wind' && moved < 900) c.flow = Math.min(1, c.flow + moved / 2400);
    c.lx = c.x; c.ly = c.y;
  }

  updateAttackMove(c, dt) {
    const e = this.enemy(c);
    if (c.attacking) {
      if (!e || e.dead || !this.sees(c, e)) { c.attacking = false; c.aaWind = null; return; }
      const gap = hyp(e.x - c.x, e.y - c.y) - c.d.radius - e.d.radius;
      c.facing = Math.atan2(e.y - c.y, e.x - c.x);
      if (c.aaWind) {
        c.aaWind.t += dt;
        if (c.aaWind.t >= c.aaWind.w) {
          c.aaWind = null;
          if (gap <= c.d.range + 60) this.doAttack(c, e);
        }
      } else if (gap <= c.d.range) {
        if (c.aaCd <= 0) {
          const per = 1 / this.as(c);
          c.aaWind = { t: 0, w: per * 0.25 };
          c.aaCd = per;
        }
      } else {
        this.stepToward(c, e.x, e.y, dt, gap - c.d.range + 1);
      }
    } else if (c.moveT) {
      const left = hyp(c.moveT.x - c.x, c.moveT.y - c.y);
      if (left < 2) c.moveT = null;
      else this.stepToward(c, c.moveT.x, c.moveT.y, dt, left);
    }
  }

  stepToward(c, tx, ty, dt, maxStep) {
    const dx = tx - c.x, dy = ty - c.y;
    const l = hyp(dx, dy);
    if (l < 0.01) return;
    const step = Math.min(this.ms(c) * dt, maxStep, l);
    c.x += dx / l * step;
    c.y += dy / l * step;
    c.facing = Math.atan2(dy, dx);
    this.clampPos(c);
  }

  updateDash(c, dt) {
    const d = c.dash;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    c.x = lerp(d.sx, d.ex, k);
    c.y = lerp(d.sy, d.ey, k);
    this.clampPos(c);
    if (d.onTick) d.onTick.call(this, c, d);
    if (k >= 1 && c.dash === d) {
      c.dash = null;
      if (d.onEnd) d.onEnd.call(this, c, d);
      if (!c.cast && !c.dash) this.runQueued(c);
    }
  }

  wallCenter(w) {
    const k = Math.min(1, (this.t - w.born) / 0.25);
    const off = 60 + 190 * k;
    return { x: w.ox + w.dx * off, y: w.oy + w.dy * off };
  }
  blockedByWall(p, px, py) {
    for (const w of this.walls) {
      if (w.owner === p.owner) continue;
      const cc = this.wallCenter(w);
      const ux = -w.dy, uy = w.dx;
      const ax = cc.x + ux * w.half, ay = cc.y + uy * w.half;
      const bx = cc.x - ux * w.half, by = cc.y - uy * w.half;
      if (segIntersect(px, py, p.x, p.y, ax, ay, bx, by)) return true;
    }
    return false;
  }

  updateProjs(dt) {
    const keep = [];
    for (const p of this.projs) {
      const px = p.x, py = p.y;
      let dead = false;
      if (p.homing !== undefined) {
        const tg = this.champs[p.homing];
        if (!tg || tg.dead) continue;
        const dx = tg.x - p.x, dy = tg.y - p.y;
        const l = hyp(dx, dy);
        const step = p.speed * dt;
        let a = Math.atan2(dy, dx);
        if (p.curve) { a += p.curve * Math.min(1, l / 300); }
        p.ang = a;
        if (l <= step + tg.d.radius) {
          p.x = tg.x; p.y = tg.y;
          if (this.blockedByWall(p, px, py)) { this.fx.push({ k: 'block', x: Math.round(p.x), y: Math.round(p.y) }); continue; }
          p.onHit(this, tg);
          continue;
        }
        p.x += Math.cos(a) * step;
        p.y += Math.sin(a) * step;
        p.life -= dt;
        if (p.life <= 0) continue;
        if (this.blockedByWall(p, px, py)) { this.fx.push({ k: 'block', x: Math.round(p.x), y: Math.round(p.y) }); continue; }
        keep.push(p);
        continue;
      }
      // 논타겟 투사체
      if (p.accel) p.speed = Math.min(p.maxSpeed, p.speed + p.accel * dt);
      const step = p.speed * dt;
      p.x += Math.cos(p.ang) * step;
      p.y += Math.sin(p.ang) * step;
      p.dist += step;
      if (p.blockable !== false && this.blockedByWall(p, px, py)) {
        this.fx.push({ k: 'block', x: Math.round(p.x), y: Math.round(p.y), big: p.kind !== 'volley' ? 1 : 0 });
        continue;
      }
      const e = this.champs[1 - p.owner];
      if (e && !e.dead && !p.hit.has(e.slot)) {
        if (segPointDist(px, py, p.x, p.y, e.x, e.y) <= p.width / 2 + e.d.radius) {
          p.hit.add(e.slot);
          p.onHit(this, e, p);
          if (!p.pierce) dead = true;
        }
      }
      if (p.dist >= p.range) dead = true;
      if (p.x < -300 || p.y < -300 || p.x > ARENA.w + 300 || p.y > ARENA.h + 300) dead = true;
      if (!dead) keep.push(p);
    }
    // onHit 안에서 새로 생긴 투사체가 있으면 함께 유지
    const added = this.projs.filter(p => p._new);
    for (const p of added) { p._new = false; if (!keep.includes(p)) keep.push(p); }
    this.projs = keep;
  }

  updateHawks(dt) {
    for (const h of this.hawks) {
      if (h.arrived) continue;
      const dx = h.tx - h.x, dy = h.ty - h.y;
      const l = hyp(dx, dy);
      const step = 1500 * dt;
      if (l <= step) { h.x = h.tx; h.y = h.ty; h.arrived = true; h.until = this.t + 5; }
      else { h.x += dx / l * step; h.y += dy / l * step; }
    }
    this.hawks = this.hawks.filter(h => !h.arrived || this.t < h.until);
  }

  separate() {
    const [a, b] = this.champs;
    if (!a || !b || a.dead || b.dead) return;
    if (a.dash || b.dash || a.spirit || b.spirit) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = hyp(dx, dy) || 0.01;
    const min = (a.d.radius + b.d.radius) * 0.85;
    if (l < min) {
      const push = (min - l) / 2;
      a.x -= dx / l * push; a.y -= dy / l * push;
      b.x += dx / l * push; b.y += dy / l * push;
      this.clampPos(a); this.clampPos(b);
    }
  }

  checkDeaths() {
    const died = [];
    for (const c of this.champs) {
      if (!c.dead && c.hp <= 0) {
        // 망령검객이 혼 이탈 중에 쓰러져도 쌓인 피해는 터진다
        if (c.key === 'soul' && c.spirit) {
          const s = c.spirit; c.spirit = null;
          const e = this.enemy(c);
          if (s.store > 1 && e && !e.dead) {
            this.deal(c, e, s.store * 0.3, 'true', { mark: true });
            this.fx.push({ k: 'soulmark', x: Math.round(e.x), y: Math.round(e.y) });
          }
        }
        died.push(c);
      }
    }
    for (const c of this.champs) if (!c.dead && c.hp <= 0 && !died.includes(c)) died.push(c);
    if (!died.length) return;
    for (const c of died) {
      c.dead = true; c.hp = 0; c.dash = null; c.cast = null; c.spirit = null;
      this.fx.push({ k: 'death', s: c.slot, x: Math.round(c.x), y: Math.round(c.y) });
      if (this.practice) c.respawnAt = this.t + 2.5;
    }
    if (this.practice) {
      for (const c of died) this.score[1 - c.slot]++;
      return;
    }
    const alive = this.champs.filter(c => !c.dead);
    if (alive.length === 1) this.score[alive[0].slot]++;
    if (this.score[0] >= this.target || this.score[1] >= this.target) {
      this.over = true;
      this.winner = this.score[0] >= this.target ? 0 : 1;
    }
    this.phase = 'roundEnd';
    this.phaseUntil = this.t + 2.6;
    this.fx.push({ k: 'roundEnd', w: alive.length === 1 ? alive[0].slot : -1, over: this.over ? 1 : 0 });
  }

  botThink(c) {
    if (this.t - c.lastHurt > 4 && c.hp < c.d.hp) c.hp = c.d.hp;
    if (c.cast || c.dash || this.isCC(c)) return;
    if (this.t >= c.botNext) {
      const sp = this.spawnPoint(c.slot);
      c.moveT = { x: sp.x + (Math.random() - 0.5) * 520, y: sp.y + (Math.random() - 0.5) * 520 };
      c.botNext = this.t + 1.6 + Math.random() * 1.4;
    }
  }

  // ───────────────────────── 화면 전송용 상태
  champState(c, full) {
    const t = this.t;
    const o = {
      s: c.slot, k: c.key, n: c.name, x: Math.round(c.x), y: Math.round(c.y), f: +c.facing.toFixed(2),
      hp: Math.max(0, Math.round(c.hp)), mh: c.d.hp, sh: Math.round(c.shields.reduce((a, s) => a + s.v, 0)),
      mn: Math.round(c.mana), mm: c.d.mana || 0, dead: c.dead ? 1 : 0,
      air: this.isAir(c) ? +(c.airUntil - t).toFixed(2) : 0,
      ult: t < c.ultUntil ? 1 : 0,
      stun: t < c.stunUntil ? +(c.stunUntil - t).toFixed(2) : 0,
      slow: c.slow && t < c.slow.until ? c.slow.pct : 0,
      cast: c.cast ? { k: c.cast.key, p: +(c.cast.t / c.cast.w).toFixed(2) } : null,
      dash: c.dash ? c.dash.kind : null,
      aw: c.aaWind ? 1 : 0,
      qs: c.qStacks, fl: +c.flow.toFixed(2), fo: c.focus,
      buf: t < c.asBuffUntil ? +(c.asBuffUntil - t).toFixed(1) : 0,
      pen: t < c.armorPenUntil ? 1 : 0,
      sp: c.spirit ? { bx: Math.round(c.spirit.bx), by: Math.round(c.spirit.by), r: +Math.max(0, c.spirit.until - t).toFixed(2), st: Math.round(c.spirit.store * 0.3) } : null,
      uns: t < c.unstoppableUntil ? 1 : 0,
    };
    if (full) {
      const cd = {};
      for (const k of ['Q', 'W', 'E', 'R', 'F']) cd[k] = +c.cds[k].toFixed(2);
      o.cd = cd;
      o.cdm = {
        Q: c.key === 'wind' ? +this.windQcd(c).toFixed(2) : c.key === 'soul' ? +Math.max(1.33, 4 * (1 - this.qRed(c))).toFixed(2) : 1,
        W: c.key === 'soul' ? +Math.max(6, 14 * (1 - this.qRed(c))).toFixed(2) : CD[c.key].W,
        E: CD[c.key].E, R: CD[c.key].R, F: CD[c.key].F,
      };
      o.hc = c.hawkCharges; o.hr = +Math.max(0, c.hawkRecharge).toFixed(1);
      o.ur = c.key === 'wind' && this.canWindUlt(c) ? 1 : 0;
      o.el = c.key === 'wind' ? +Math.max(0, c.eLockUntil - t).toFixed(1) : 0;
      o.es = c.eStacks;
    }
    return o;
  }

  snapshot(slot, fx) {
    const me = this.champs[slot];
    const out = {
      t: +this.t.toFixed(3), ph: this.phase, pu: +Math.max(0, this.phaseUntil - this.t).toFixed(2),
      sc: this.score, rd: this.round, tg: this.target, pr: this.practice ? 1 : 0,
      ch: [], pj: [], wl: [], hk: [], fx,
    };
    for (const c of this.champs) {
      if (c !== me && !this.sees(me, c)) out.ch.push({ s: c.slot, k: c.key, n: c.name, hid: 1, dead: c.dead ? 1 : 0, mh: c.d.hp });
      else out.ch.push(this.champState(c, c === me));
    }
    for (const p of this.projs) out.pj.push({ i: p.id, k: p.kind, o: p.owner, x: Math.round(p.x), y: Math.round(p.y), a: +p.ang.toFixed(2) });
    for (const w of this.walls) {
      const cc = this.wallCenter(w);
      out.wl.push({ i: w.id, o: w.owner, x: Math.round(cc.x), y: Math.round(cc.y), dx: +w.dx.toFixed(3), dy: +w.dy.toFixed(3), h: w.half, r: +(w.until - this.t).toFixed(2) });
    }
    for (const h of this.hawks) if (h.owner === slot) out.hk.push({ i: h.id, x: Math.round(h.x), y: Math.round(h.y), a: h.arrived ? 1 : 0 });
    return out;
  }
}

// ───────────────────────── 스킬 정의
const SKILLS = {
  wind: {
    // Q 찌르기 바람: 2회 적중 후 세 번째는 회오리
    Q(c, tx, ty) {
      const red = this.qRed(c);
      c.cds.Q = this.windQcd(c);
      const tornado = c.qStacks >= 2;
      this.startCast(c, 'Q', 0.38 * (1 - red), function (c2) {
        const d = this.aimDir(c2, tx, ty);
        c2.facing = Math.atan2(d.y, d.x);
        const e = this.enemy(c2);
        if (tornado) {
          c2.qStacks = 0;
          this.projs.push({
            id: this.nextId++, kind: 'tornado', owner: c2.slot, x: c2.x, y: c2.y, ang: c2.facing,
            speed: 1200, range: 1150, width: 180, dist: 0, hit: new Set(), pierce: true,
            onHit: (g, tgt) => {
              const q = g.windQdmg(c2);
              g.deal(c2, tgt, q.v, 'phys', { crit: q.cr, armorIgnore: g.windArmorIgnore(c2, tgt, q.cr) });
              g.knockup(tgt, 1.0);
            },
          });
          this.fx.push({ k: 'tornadoCast', s: c2.slot });
          return;
        }
        const ex = c2.x + d.x * 475, ey = c2.y + d.y * 475;
        this.fx.push({ k: 'thrust', s: c2.slot, x: Math.round(c2.x), y: Math.round(c2.y), a: +c2.facing.toFixed(2), l: 475 });
        if (e && !e.dead && segPointDist(c2.x, c2.y, ex, ey, e.x, e.y) <= 45 + e.d.radius) {
          const q = this.windQdmg(c2);
          this.deal(c2, e, q.v, 'phys', { crit: q.cr, armorIgnore: this.windArmorIgnore(c2, e, q.cr) });
          this.addQStack(c2);
        }
      }, { tornado });
    },
    // W 바람 장벽: 4초간 적 투사체 소멸
    W(c, tx, ty) {
      const d = this.aimDir(c, tx, ty);
      c.facing = Math.atan2(d.y, d.x);
      c.cds.W = CD.wind.W;
      this.walls.push({ id: this.nextId++, owner: c.slot, ox: c.x, oy: c.y, dx: d.x, dy: d.y, half: 230, born: this.t, until: this.t + 4 });
      this.fx.push({ k: 'wallCast', s: c.slot });
    },
    // E 돌파 베기: 적을 관통해 475 돌진
    E(c, tx, ty) {
      const e = this.enemy(c);
      if (!e || e.dead || !this.sees(c, e)) return;
      if (this.t < c.eLockUntil) return;
      if (hyp(e.x - c.x, e.y - c.y) > 475 + c.d.radius + e.d.radius) return;
      const dx = e.x - c.x, dy = e.y - c.y, l = hyp(dx, dy) || 1;
      c.cds.E = CD.wind.E;
      c.eLockUntil = this.t + 6;
      if (c.cds.Q > 0 && c.cds.Q <= 0.5) c.cds.Q = 0;
      const stacks = this.t < c.eStackUntil ? c.eStacks : 0;
      c.eStacks = Math.min(4, stacks + 1);
      c.eStackUntil = this.t + 5;
      c.attacking = false; c.moveT = null; c.aaWind = null;
      c.facing = Math.atan2(dy, dx);
      c.dash = {
        kind: 'windE', sx: c.x, sy: c.y, ex: c.x + dx / l * 475, ey: c.y + dy / l * 475, t: 0, dur: 0.36,
        onEnd(c2, dd) {
          const e2 = this.enemy(c2);
          if (e2 && !e2.dead) this.deal(c2, e2, (100 + 0.2 * c2.d.bonusAd) * (1 + 0.25 * stacks), 'magic');
          if (dd.eq) {
            const stk = c2.qStacks >= 2;
            this.startCast(c2, 'Q', 0.12, function (c3) {
              this.fx.push({ k: 'circle', s: c3.slot, x: Math.round(c3.x), y: Math.round(c3.y), r: 375 });
              const e3 = this.enemy(c3);
              if (e3 && !e3.dead && hyp(e3.x - c3.x, e3.y - c3.y) <= 375 + e3.d.radius) {
                const q = this.windQdmg(c3);
                this.deal(c3, e3, q.v, 'phys', { crit: q.cr, armorIgnore: this.windArmorIgnore(c3, e3, q.cr) });
                if (stk) { this.knockup(e3, 1.0); c3.qStacks = 0; }
                else this.addQStack(c3);
              } else if (stk) c3.qStacks = 0;
            });
          }
        },
      };
      this.fx.push({ k: 'dashE', s: c.slot });
    },
    // R 마지막 바람: 공중에 뜬 적에게 순간이동
    R(c) {
      if (!this.canWindUlt(c)) return;
      const e = this.enemy(c);
      const dx = e.x - c.x, dy = e.y - c.y, l = hyp(dx, dy) || 1;
      c.cast = null; c.attacking = false; c.moveT = null;
      c.x = e.x + dx / l * 70; c.y = e.y + dy / l * 70;
      this.clampPos(c);
      c.facing = Math.atan2(-dy, -dx);
      c.cds.R = CD.wind.R;
      e.airUntil = Math.max(e.airUntil, this.t + 1.0);
      e.airDur = e.airUntil - this.t;
      this.interrupt(e);
      c.ultUntil = this.t + 0.85;
      c.unstoppableUntil = this.t + 0.85;
      c.flow = 1;
      c.qStacks = 0;
      this.fx.push({ k: 'windUlt', s: c.slot, x: Math.round(e.x), y: Math.round(e.y) });
      this.startCast(c, 'R', 0.85, function (c2) {
        const e2 = this.enemy(c2);
        if (e2 && !e2.dead) this.deal(c2, e2, 350 + 1.5 * c2.d.bonusAd, 'phys');
        c2.armorPenUntil = this.t + 15;
        this.fx.push({ k: 'slam', x: Math.round(e2 ? e2.x : c2.x), y: Math.round(e2 ? e2.y : c2.y) });
      }, { uncancel: true });
    },
  },

  soul: {
    // Q 필살 찌르기: 세 번째는 돌진하며 띄우기
    Q(c, tx, ty) {
      const red = this.qRed(c);
      c.cds.Q = Math.max(1.33, CD.soul.Q * (1 - red));
      const third = c.qStacks >= 2;
      this.startCast(c, 'Q', 0.36 * (1 - red), function (c2) {
        const d = this.aimDir(c2, tx, ty);
        c2.facing = Math.atan2(d.y, d.x);
        const e = this.enemy(c2);
        const qd = () => { const cr = this.crit(c2); return { v: (75 + 1.05 * c2.d.ad) * (cr ? c2.d.critMul : 1), cr }; };
        if (third) {
          c2.qStacks = 0;
          let hit = false;
          c2.dash = {
            kind: 'soulQ', sx: c2.x, sy: c2.y, ex: c2.x + d.x * 450, ey: c2.y + d.y * 450, t: 0, dur: 0.3,
            onTick(c3) {
              const e3 = this.enemy(c3);
              if (hit || !e3 || e3.dead) return;
              if (hyp(e3.x - c3.x, e3.y - c3.y) <= c3.d.radius + e3.d.radius + 45) {
                hit = true;
                const q = qd();
                this.deal(c3, e3, q.v, 'phys', { crit: q.cr });
                this.knockup(e3, 0.75);
              }
            },
          };
          this.fx.push({ k: 'gust', s: c2.slot, x: Math.round(c2.x), y: Math.round(c2.y), a: +c2.facing.toFixed(2) });
          return;
        }
        const ex = c2.x + d.x * 470, ey = c2.y + d.y * 470;
        this.fx.push({ k: 'thrust', s: c2.slot, x: Math.round(c2.x), y: Math.round(c2.y), a: +c2.facing.toFixed(2), l: 470 });
        if (e && !e.dead && segPointDist(c2.x, c2.y, ex, ey, e.x, e.y) <= 45 + e.d.radius) {
          const q = qd();
          this.deal(c2, e, q.v, 'phys', { crit: q.cr });
          c2.qStacks = Math.min(2, c2.qStacks + 1);
          c2.qStackUntil = this.t + 6;
        }
      }, { third });
    },
    // W 혼 가르기: 부채꼴 최대 체력 비례 + 보호막
    W(c, tx, ty) {
      const red = this.qRed(c);
      c.cds.W = Math.max(6, CD.soul.W * (1 - red));
      this.startCast(c, 'W', Math.max(0.2, 0.5 * (1 - red)), function (c2) {
        const d = this.aimDir(c2, tx, ty);
        c2.facing = Math.atan2(d.y, d.x);
        this.fx.push({ k: 'cone', s: c2.slot, x: Math.round(c2.x), y: Math.round(c2.y), a: +c2.facing.toFixed(2), r: 600, arc: 1.4 });
        const e = this.enemy(c2);
        if (!e || e.dead) return;
        const dist = hyp(e.x - c2.x, e.y - c2.y);
        let da = Math.atan2(e.y - c2.y, e.x - c2.x) - c2.facing;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const angTol = 0.7 + Math.atan2(e.d.radius, Math.max(dist, 1));
        if (dist <= 600 + e.d.radius && Math.abs(da) <= angTol) {
          const total = 30 + 0.1 * e.d.hp;
          this.deal(c2, e, total / 2, 'phys');
          this.deal(c2, e, total / 2, 'magic');
          c2.shields.push({ v: 2 * (65 + 0.65 * c2.d.bonusAd), until: this.t + 1.5 });
          this.fx.push({ k: 'soulShield', s: c2.slot });
        }
      });
    },
    // E 혼 이탈: 5초간 영혼으로 싸우고 몸으로 돌아오며 30% 고정 피해
    E(c, tx, ty) {
      const d = this.aimDir(c, tx, ty);
      c.facing = Math.atan2(d.y, d.x);
      const bx = clamp(c.x - d.x * 150, 40, ARENA.w - 40), by = clamp(c.y - d.y * 150, 40, ARENA.h - 40);
      c.spirit = { bx, by, start: this.t, until: this.t + 5, store: 0 };
      c.cds.E = 0;
      c.attacking = false; c.moveT = null; c.aaWind = null;
      c.dash = { kind: 'soulE', sx: c.x, sy: c.y, ex: c.x + d.x * 300, ey: c.y + d.y * 300, t: 0, dur: 0.22 };
      this.fx.push({ k: 'soulOut', s: c.slot, x: Math.round(c.x), y: Math.round(c.y) });
    },
    // R 봉인참: 직선 끝의 적 뒤로 순간이동하며 끌어당겨 띄우기
    R(c, tx, ty) {
      const d = this.aimDir(c, tx, ty);
      c.facing = Math.atan2(d.y, d.x);
      c.cds.R = CD.soul.R;
      c.unstoppableUntil = this.t + 0.65;
      const sx = c.x, sy = c.y;
      this.fx.push({ k: 'sealAim', s: c.slot, x: Math.round(sx), y: Math.round(sy), a: +c.facing.toFixed(2), l: 1000 });
      this.startCast(c, 'R', 0.65, function (c2) {
        const ox = c2.x, oy = c2.y;
        const ex = ox + d.x * 1000, ey = oy + d.y * 1000;
        const e = this.enemy(c2);
        let hitE = e && !e.dead && segPointDist(ox, oy, ex, ey, e.x, e.y) <= 112 + e.d.radius;
        if (hitE) {
          c2.x = e.x + d.x * 95; c2.y = e.y + d.y * 95;
          this.clampPos(c2);
          e.x += (c2.x - e.x) * 0.35; e.y += (c2.y - e.y) * 0.35;
          this.clampPos(e);
          this.knockup(e, 0.75);
          this.deal(c2, e, 200 + 0.4 * c2.d.bonusAd, 'phys');
          this.deal(c2, e, 200 + 0.4 * c2.d.bonusAd, 'magic');
        } else {
          c2.x = ex; c2.y = ey;
          this.clampPos(c2);
        }
        this.fx.push({ k: 'seal', s: c2.slot, x1: Math.round(ox), y1: Math.round(oy), x2: Math.round(c2.x), y2: Math.round(c2.y), hit: hitE ? 1 : 0 });
      }, { uncancel: true });
    },
  },

  frost: {
    // Q 연사 집중: 기본 공격 4회 후 사용, 6초간 다섯 발씩
    Q(c) {
      if (c.focus < 4 || c.mana < 30) return;
      c.mana -= 30;
      c.focus = 0;
      c.asBuffUntil = this.t + 6;
      c.aaCd = 0;
      c.aaWind = null;
      this.fx.push({ k: 'focus', s: c.slot });
    },
    // W 부채 사격: 9발, 대상당 한 번만 피해
    W(c, tx, ty) {
      if (c.mana < 60) return;
      c.mana -= 60;
      c.cds.W = CD.frost.W;
      this.startCast(c, 'W', 0.25, function (c2) {
        const d = this.aimDir(c2, tx, ty);
        c2.facing = Math.atan2(d.y, d.x);
        const volley = { hit: false };
        for (let i = 0; i < 9; i++) {
          const ang = c2.facing + (i - 4) * (0.87 / 8);
          this.projs.push({
            id: this.nextId++, kind: 'volley', owner: c2.slot, x: c2.x, y: c2.y, ang, speed: 2000, range: 1200,
            width: 26, dist: 0, hit: new Set(),
            onHit: (g, tgt) => {
              if (volley.hit) return;
              volley.hit = true;
              g.deal(c2, tgt, 130 + 1.0 * c2.d.bonusAd, 'phys', { crit: true });
              g.setSlow(tgt, 0.5, 2);
            },
          });
        }
        this.fx.push({ k: 'shoot', s: c2.slot });
      });
    },
    // E 정찰 매: 경로와 도착 지점 시야
    E(c, tx, ty) {
      if (c.hawkCharges <= 0) return;
      if (c.hawkCharges === 2) c.hawkRecharge = 35;
      c.hawkCharges--;
      c.cds.E = CD.frost.E;
      this.hawks.push({ id: this.nextId++, owner: c.slot, x: c.x, y: c.y, tx: clamp(tx, 0, ARENA.w), ty: clamp(ty, 0, ARENA.h), arrived: false, until: 0 });
      this.fx.push({ k: 'hawk', s: c.slot });
    },
    // R 얼음 수정 화살: 멀리 날아갈수록 긴 기절
    R(c, tx, ty) {
      if (c.mana < 100) return;
      c.mana -= 100;
      c.cds.R = CD.frost.R;
      this.startCast(c, 'R', 0.25, function (c2) {
        const d = this.aimDir(c2, tx, ty);
        c2.facing = Math.atan2(d.y, d.x);
        this.projs.push({
          id: this.nextId++, kind: 'crystal', owner: c2.slot, x: c2.x, y: c2.y, ang: c2.facing, speed: 1500, accel: 200, maxSpeed: 2100,
          range: 6000, width: 130, dist: 0, hit: new Set(),
          onHit: (g, tgt, p) => {
            const dur = clamp(1 + 2.5 * (p.dist / 2800), 1, 3.5);
            g.deal(c2, tgt, 400, 'magic');
            g.stun(tgt, dur);
            g.setSlow(tgt, 0.5, dur + 1.5);
            g.fx.push({ k: 'shatter', x: Math.round(tgt.x), y: Math.round(tgt.y), d: +dur.toFixed(1) });
          },
        });
        this.fx.push({ k: 'crystalCast', s: c2.slot });
      });
    },
  },
};

module.exports = { Game, CHAMPS, ARENA, VISION, HAWK_VISION };
