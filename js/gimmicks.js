'use strict';
// 追加ギミック：重さスイッチ＋扉、動く足場、トランポリン、崩れる足場、回転ノコギリ
//
// ステージデータ（levels.js）での書き方
//  switches: [x, 地面y, 色id]                       … 上に何か（猫・箱・トゲ）が乗っている間 ON
//  doors:    [x, 上端y, 下端y, 色id, 'all'?]        … 同じ色のスイッチがどれか ON の間だけ上に開く。
//                                                 'all' を付けると全部 同時に ON で開き、開きっぱなしになる（2人同時スイッチ）
//  movers:   [x1, y1, x2, y2, 幅, 周期, 色id?]     … 2点間を往復する足場。色id を付けるとスイッチ ON の間だけ x2,y2 側へ動く
//  tramps:   [x, 地面y, 幅]                         … 上から落ちてきた物を高くはね上げる
//  crumbles: [x, 上面y, 幅]                         … 猫が乗るとゆれて崩れ落ち、しばらくすると元に戻る
//  saws:     [x1, y1, x2, y2, 周期, 半径]           … 回転ノコギリ。2点間を往復（同じ点なら その場で回転）。当たると刺さる
const SWITCH_W = 64;
const DOOR_W = 26;
const MOVER_H = 20;
const CRUMBLE_H = 24;
const TRAMP_H = 26;
const TRAMP_V = 14.5, TRAMP_THROWN_V = 19.5;   // はね上げる速さ（普通 / 投げられて飛んできた物）
const CRUMBLE_SHAKE = 50, CRUMBLE_BACK = 240;  // 崩れるまで / 元に戻るまで（フレーム）
const GIMMICK_COLORS = ['#ffd23f', '#5aa9e6', '#45c9a6', '#ff7aa8'];

function buildGimmicks(L, statics, dyn) {
  const g = { switches: [], doors: [], movers: [], tramps: [], crumbles: [], saws: [] };
  for (const [x, gy, id] of L.switches || []) g.switches.push({ x, gy, id, pressed: false });
  for (const [x, top, bottom, id, mode] of L.doors || []) {
    const h = bottom - top;
    const body = Bodies.rectangle(x, top + h / 2, DOOR_W, h, { isStatic: true, label: 'door', friction: 0.3 });
    dyn.push({ kind: 'door', body, w: DOOR_W, h, id });
    g.doors.push({ body, x, cy: top + h / 2, h, id, open: 0, all: mode === 'all', latched: false });
  }
  for (const [x1, y1, x2, y2, w, period, id] of L.movers || []) {
    const body = Bodies.rectangle(x1, y1, w, MOVER_H, { isStatic: true, label: 'mover', friction: 1 });
    dyn.push({ kind: 'mover', body, w, h: MOVER_H, id: id ?? null });
    g.movers.push({ body, x1, y1, x2, y2, period: period || 240, id: id ?? null, s: 0 });
  }
  for (const [x, gy, w] of L.tramps || []) {
    const body = Bodies.rectangle(x, gy - TRAMP_H / 2, w, TRAMP_H, { isStatic: true, label: 'tramp', friction: 0.6 });
    statics.push(body);
    g.tramps.push({ body, x, gy, w });
  }
  for (const [x, top, w] of L.crumbles || []) {
    const body = Bodies.rectangle(x, top + CRUMBLE_H / 2, w, CRUMBLE_H, { label: 'crumble', friction: 0.8, density: 0.002 });
    Body.setStatic(body, true);   // dynamic で作ってから固定（崩れる時に質量を戻せるように）
    dyn.push({ kind: 'crumble', body, w, h: CRUMBLE_H });
    g.crumbles.push({ body, x, y: top + CRUMBLE_H / 2, state: 'idle', t: 0 });
  }
  for (const [x1, y1, x2, y2, period, r] of L.saws || []) {
    const body = Bodies.circle(x1, y1, r || 34, { isStatic: true, label: 'spike', collisionFilter: { category: CAT_SPIKE } });
    dyn.push({ kind: 'saw', body, r: r || 34 });
    g.saws.push({ body, x1, y1, x2, y2, period: period || 180 });
  }
  return g;
}

const smooth = t => t * t * (3 - 2 * t);
// all = true なら同じ色のスイッチが全部 ON、false ならどれか1つ ON
const switchOn = (g, id, all = false) => {
  const sw = g.switches.filter(s => s.id === id);
  return sw.length > 0 && (all ? sw.every(s => s.pressed) : sw.some(s => s.pressed));
};

// 物理を進める前：足場・扉・ノコギリを動かす
Sim.prototype.updateGimmicksPre = function () {
  const lv = this.lv, g = lv.gm, f = this.frame;

  for (const d of g.doors) {
    if (d.all && !d.latched && switchOn(g, d.id, true)) { d.latched = true; this.events.push(['o', Math.round(d.x), Math.round(d.cy)]); }
    const want = (d.all ? d.latched : switchOn(g, d.id)) ? 1 : 0;
    if (d.open !== want) {
      d.open = Math.max(0, Math.min(1, d.open + (want ? 0.06 : -0.04)));
      Body.setPosition(d.body, { x: d.x, y: d.cy - smooth(d.open) * (d.h - 12) });
    }
  }

  for (const m of g.movers) {
    let s;
    if (m.id == null) {
      // 往復。両端で少し止まるので乗り降りしやすい
      const ph = (f / m.period) % 1, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      s = smooth(Math.max(0, Math.min(1, (tri - 0.12) / 0.76)));
    }
    else {
      m.s = Math.max(0, Math.min(1, m.s + (switchOn(g, m.id) ? 1 : -1) * 2 / m.period));
      s = smooth(m.s);
    }
    const x = m.x1 + (m.x2 - m.x1) * s, y = m.y1 + (m.y2 - m.y1) * s;
    const dx = x - m.body.position.x, dy = y - m.body.position.y;
    if (!dx && !dy) continue;
    // 上に乗っている物を一緒に運ぶ
    const top = m.body.bounds.min.y, l = m.body.bounds.min.x, r = m.body.bounds.max.x;
    for (const b of lv.carryables) {
      if (b.isStatic) continue;
      const bb = b.bounds;
      if (bb.max.x > l + 2 && bb.min.x < r - 2 && Math.abs(bb.max.y - top) < 7) Body.translate(b, { x: dx, y: dy });
    }
    Body.setPosition(m.body, { x, y });
  }

  for (const s of g.saws) {
    const t = (1 - Math.cos(2 * Math.PI * f / s.period)) / 2;
    Body.setPosition(s.body, { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });
    Body.setAngle(s.body, f * 0.25);
  }
};

// 物理を進めた後：スイッチ判定・トランポリン・崩れる足場
Sim.prototype.updateGimmicksPost = function () {
  const lv = this.lv, g = lv.gm;

  g.switches.forEach((s, i) => {
    const bounds = { min: { x: s.x - SWITCH_W / 2 + 6, y: s.gy - 24 }, max: { x: s.x + SWITCH_W / 2 - 6, y: s.gy - 1 } };
    const on = Matter.Query.region(lv.carryables, bounds).length > 0;
    if (on !== s.pressed) { s.pressed = on; this.events.push(['s', i, on ? 1 : 0]); }
  });

  // トランポリン（当たった瞬間の落下速度から はね返す速さを決める）
  for (const [body, info] of this.bounces) {
    const v = info.thrown ? TRAMP_THROWN_V : TRAMP_V;
    body.plugin.thrownUntil = 0;
    Body.setVelocity(body, { x: body.velocity.x, y: -v });
    const bn = body.plugin.bunny;
    if (bn) { bn.coyote = 0; bn.jumpCd = 10; bn.jumping = false; }
    this.events.push(['b', info.i]);
  }
  this.bounces.clear();

  for (const c of g.crumbles) {
    const body = c.body;
    if (c.state === 'idle') {
      if (lv.bunnies.some(b => b.groundBody === body)) { c.state = 'shake'; c.t = CRUMBLE_SHAKE; this.events.push(['k', Math.round(c.x), Math.round(c.y)]); }
    } else if (c.state === 'shake') {
      // 2人で乗っていると 2倍の速さで崩れる
      c.t -= Math.max(1, lv.bunnies.filter(b => b.groundBody === body).length);
      Body.setPosition(body, { x: c.x + ((c.t % 4) < 2 ? -1.5 : 1.5), y: c.y });
      if (c.t <= 0) {
        Body.setPosition(body, { x: c.x, y: c.y });
        Body.setStatic(body, false);
        body.collisionFilter.mask = 0;   // 何ともぶつからずに落ちていく
        Body.setVelocity(body, { x: 0, y: 1 });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.04);
        c.state = 'fall'; c.t = CRUMBLE_BACK;
      }
    } else if (c.state === 'fall') {
      if (--c.t <= 0) {
        Body.setStatic(body, true);
        body.collisionFilter.mask = 0xFFFFFFFF;
        Body.setAngle(body, 0);
        Body.setPosition(body, { x: c.x, y: c.y });
        c.state = 'idle';
        this.events.push(['K', Math.round(c.x), Math.round(c.y)]);
      }
    }
  }
};

// collisionStart で呼ぶ：トランポリンに上から落ちてきた物を記録
Sim.prototype.checkTramp = function (me, other) {
  if (other.label !== 'tramp' || me.isStatic || me.velocity.y < 1) return;
  if (me.position.y > other.position.y - 6) return;   // 横や下からは はねない
  const i = this.lv.gm.tramps.findIndex(t => t.body === other);
  this.bounces.set(me, { vy: me.velocity.y, i, thrown: (me.plugin.thrownUntil || 0) > this.frame });
};
