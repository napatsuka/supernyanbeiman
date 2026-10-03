'use strict';
// 物理シミュレーション（ホスト側だけが進める。クライアントは buildLevel で形状情報だけ使う）
const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter;

const IN_L = 1, IN_R = 2, IN_J = 4, IN_G = 8;
const STEP_MS = 1000 / 60;
const BUNNY_W = 36, BUNNY_H = 60;
const REACH = 56;           // つかめる距離（体の中心から）
const GROUND_BOTTOM = 1700; // 地面の底

const CAT_DEFAULT = 0x0001, CAT_ROPE = 0x0002, CAT_SPIKE = 0x0004;
const IMPALE_FRAMES = 150;
const SAFE_FRAMES = 90;     // 復活・ワープ直後の無敵時間（1.5秒）
const WARP_COOLDOWN = 60;
const THROW_VX = 8.5, THROW_VY = -11.5;   // 投げる強さ
const canThrow = t => !t.isStatic && (t.label === 'bunny' || t.label === 'crate' || t.label === 'looseSpike');
const LOOSE_LEN = 96, LOOSE_W = 12; // 落ちているトゲの長さ・半幅

// 落ちているトゲの先端（重心から一番遠い頂点）
function spikeTip(body) {
  let best = null, bd = -1;
  for (const v of body.vertices) {
    const d = (v.x - body.position.x) ** 2 + (v.y - body.position.y) ** 2;
    if (d > bd) { bd = d; best = v; }
  }
  return best;
} // トゲに刺さっている時間（2.5秒）

function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

function buildLevel(idx) {
  const L = LEVELS[idx];
  const engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 6;
  const world = engine.world;
  const statics = [], dyn = [], grabbables = [], links = [];

  for (const [x1, x2, top] of L.ground) {
    const w = x2 - x1, h = GROUND_BOTTOM - top;
    statics.push(Bodies.rectangle(x1 + w / 2, top + h / 2, w, h, { isStatic: true, label: 'ground', friction: 0.8 }));
  }
  for (const [x1, x2, y] of L.spikes || []) {
    statics.push(Bodies.rectangle((x1 + x2) / 2, y - 10, x2 - x1, 20, { isStatic: true, label: 'spike', collisionFilter: { category: CAT_SPIKE } }));
  }
  // 細長いトゲ: [根元x, 地面y, 高さ, 半幅]
  for (const [x, gy, h, w] of L.tallSpikes || []) {
    statics.push(Body.create({
      position: { x, y: gy - h / 3 }, // 三角形の重心
      vertices: [{ x: x - w, y: gy }, { x, y: gy - h }, { x: x + w, y: gy }],
      isStatic: true, label: 'spike', collisionFilter: { category: CAT_SPIKE },
    }));
  }
  for (const [x, y] of L.pegs || []) {
    const p = Bodies.circle(x, y, 9, { isStatic: true, isSensor: true, label: 'peg' });
    statics.push(p); grabbables.push(p);
  }

  // うさぎ（dyn の 0, 1 番）
  const bunnies = [0, 1].map(id => {
    const [cx, cy] = L.checkpoints[0];
    const body = Bodies.rectangle(cx + (id ? 30 : -30), cy, BUNNY_W, BUNNY_H, {
      chamfer: { radius: 17 }, density: 0.0015, friction: 0.7, frictionStatic: 1,
      restitution: 0, frictionAir: 0.012, label: 'bunny',
    });
    const b = {
      id, body, facing: id ? -1 : 1, moveFacing: 1, coyote: 0, jumpBuf: 0, jumpCd: 0, jumping: false,
      grab: null, grabCd: 0, lastGrab: null, lastGrabT: 0,
      touching: false, groundBody: null, hitSpike: null, impaled: 0, lastJc: null, safeT: 0, warpCd: 0,
      inWater: false, waterTop: 0, cannon: null, cannonCd: 0, burnT: 0,
    };
    body.plugin.bunny = b;
    dyn.push({ kind: 'bunny', id, body });
    grabbables.push(body);
    return b;
  });

  (L.ropes || []).forEach(([ax, ay, n], ri) => {
    let prev = null;
    const SEG = 22;
    for (let i = 0; i < n; i++) {
      const s = Bodies.rectangle(ax, ay + SEG / 2 + i * SEG, 8, SEG, {
        density: 0.004, frictionAir: 0.02, label: 'rope',
        collisionFilter: { category: CAT_ROPE, mask: 0 },
      });
      links.push(prev
        ? Constraint.create({ bodyA: prev, pointA: { x: 0, y: SEG / 2 }, bodyB: s, pointB: { x: 0, y: -SEG / 2 }, length: 0, stiffness: 1 })
        : Constraint.create({ pointA: { x: ax, y: ay }, bodyB: s, pointB: { x: 0, y: -SEG / 2 }, length: 0, stiffness: 1 }));
      s.plugin.group = 'rope' + ri;   // 同じロープの節はまとめて扱う
      dyn.push({ kind: 'rope', body: s, first: i === 0, anchor: i === 0 ? { x: ax, y: ay } : null });
      grabbables.push(s);
      if (prev) prev.plugin.next = s;
      prev = s;
    }
  });
  // 落ちているトゲ（持てる。先端に刺さるとアウト）: [x, 地面y, 向き(1=右/-1=左)]
  for (const [x, gy, dir] of L.looseSpikes || []) {
    const len = LOOSE_LEN, w = LOOSE_W;
    const t = Body.create({
      position: { x: 0, y: 0 },
      vertices: [{ x: -w, y: len / 3 }, { x: 0, y: -len * 2 / 3 }, { x: w, y: len / 3 }],
      density: 0.002, friction: 0.6, frictionAir: 0.01, label: 'looseSpike',
      collisionFilter: { category: CAT_SPIKE },
    });
    Body.setAngle(t, dir < 0 ? -Math.PI / 2 : Math.PI / 2);
    Body.setPosition(t, { x, y: gy - w - 2 });
    dyn.push({ kind: 'loose', body: t });
    grabbables.push(t);
  }
  // 落ちてくるトゲ: [x, 吊り下げ位置y, 反応する横幅]
  const droppers = [];
  for (const [x, y, range] of L.dropSpikes || []) {
    const len = LOOSE_LEN, w = LOOSE_W;
    const t = Body.create({
      position: { x: 0, y: 0 },
      vertices: [{ x: -w, y: len / 3 }, { x: 0, y: -len * 2 / 3 }, { x: w, y: len / 3 }],
      density: 0.002, friction: 0.6, frictionAir: 0.005, label: 'looseSpike',
      collisionFilter: { category: CAT_SPIKE },
    });
    Body.setAngle(t, Math.PI);          // 先端を下に
    Body.setPosition(t, { x, y });
    Body.setStatic(t, true);            // 落ちるまでは固定（dynamic で作ってから固定し、質量を復元できるように）
    dyn.push({ kind: 'loose', body: t });
    grabbables.push(t);
    droppers.push({ body: t, x, y, range: range || 120, state: 'idle', t: 0 });
  }
  for (const [x, y, s] of L.crates || []) {
    const c = Bodies.rectangle(x, y, s, s, { chamfer: { radius: 4 }, density: 0.0012, friction: 0.8, label: 'crate' });
    dyn.push({ kind: 'crate', body: c, w: s, h: s });
    grabbables.push(c);
  }
  for (const [x, y, len] of L.seesaws || []) {
    const p = Bodies.rectangle(x, y, len, 14, { density: 0.001, friction: 0.9, label: 'plank' });
    links.push(Constraint.create({ bodyA: p, pointB: { x, y }, length: 0, stiffness: 1 }));
    dyn.push({ kind: 'plank', body: p, w: len, h: 14 });
    grabbables.push(p);
  }

  const gm = buildGimmicks(L, statics, dyn);   // スイッチ・扉・動く足場など（gimmicks.js）

  Composite.add(world, [...statics, ...dyn.map(d => d.body), ...links]);
  const hazards = [...statics.filter(b => b.label === 'spike'), ...droppers.map(d => d.body), ...gm.saws.map(s => s.body)];
  // 動く足場で運ばれる・スイッチを押せる物
  const carryables = dyn.filter(d => d.kind === 'bunny' || d.kind === 'crate' || d.kind === 'loose').map(d => d.body);
  return { idx, L, engine, world, dyn, grabbables, bunnies, droppers, hazards, gm, carryables, cp: 0 };
}

function closestPointOnBody(body, p) {
  let best = null, bd = Infinity;
  const parts = body.parts.length > 1 ? body.parts.slice(1) : body.parts;
  for (const part of parts) {
    if (part.circleRadius) {
      const dx = p.x - part.position.x, dy = p.y - part.position.y;
      const d = Math.hypot(dx, dy) || 1, r = part.circleRadius;
      const q = d < r ? { x: p.x, y: p.y } : { x: part.position.x + dx / d * r, y: part.position.y + dy / d * r };
      const qd = Math.hypot(q.x - p.x, q.y - p.y);
      if (qd < bd) { bd = qd; best = q; }
      continue;
    }
    const v = part.vertices;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
      const qx = a.x + ex * t, qy = a.y + ey * t;
      const qd = Math.hypot(qx - p.x, qy - p.y);
      if (qd < bd) { bd = qd; best = { x: qx, y: qy }; }
    }
  }
  return { point: best, dist: bd };
}

class Sim {
  constructor(levelIdx = 0) {
    this.events = [];
    this.totalFrames = 0;
    this.load(levelIdx);
  }

  load(idx) {
    this.lv = buildLevel(idx);
    this.epoch = (this.epoch || 0) + 1;
    this.frame = 0;
    this.clearT = 0;
    this.allClear = false;
    this.bounces = new Map();
    const onCol = e => this.onCollision(e);
    Events.on(this.lv.engine, 'collisionStart', onCol);
    Events.on(this.lv.engine, 'collisionActive', onCol);
    this.events.push(['L', idx]);
  }

  restart() { this.load(this.lv.idx); }

  onCollision(e) {
    for (const pair of e.pairs) {
      if (pair.isSensor) continue;
      const A = pair.bodyA.parent, B = pair.bodyB.parent;
      const pts = pair.activeContacts ? pair.activeContacts.map(c => c.vertex) : (pair.collision.supports || []);
      for (const [me, other] of [[A, B], [B, A]]) {
        if (e.name === 'collisionStart') this.checkTramp(me, other);
        const bn = me.plugin && me.plugin.bunny;
        if (!bn) continue;
        if (other.label === 'spike' && !bn.hitSpike) bn.hitSpike = pts.find(Boolean) || { x: me.position.x, y: me.position.y };
        // 落ちているトゲは先端に触れた時だけ刺さる（自分で持っているトゲは除く）
        if (other.label === 'looseSpike' && !bn.hitSpike && !(bn.grab && bn.grab.target === other) && !other.plugin.stuck
          && !(other.plugin.owner === bn.id && this.frame < other.plugin.ownerUntil)) {   // 投げた直後の本人には刺さらない
          const tip = spikeTip(other);
          if (pts.some(s => s && Math.hypot(s.x - tip.x, s.y - tip.y) < 12)) { bn.hitSpike = { x: tip.x, y: tip.y }; bn.hitBy = other; }
        }
        for (const s of pts) {
          if (!s) continue;
          const dx = s.x - me.position.x, dy = s.y - me.position.y;
          if (dy / (Math.hypot(dx, dy) || 1) > 0.65) { bn.touching = true; bn.groundBody = other; break; }
        }
      }
    }
  }

  step(inputs) {
    const lv = this.lv;
    for (const b of lv.bunnies) this.control(b, inputs[b.id] || { mask: 0, jc: 0 });
    for (const b of lv.bunnies) { b.touching = false; b.groundBody = null; b.hitSpike = null; b.hitBy = null; }

    this.updateGimmicksPre();
    Engine.update(lv.engine, STEP_MS);
    this.updateGimmicksPost();

    for (const b of lv.bunnies) {
      b.coyote = b.touching ? 6 : b.coyote - 1;
      if (b.safeT > 0) b.safeT--;
      if (b.warpCd > 0) b.warpCd--;
      if (b.grab) {
        const c = b.grab.c;
        c.length = Math.max(3, c.length * 0.88);
        // ロープは少しずつ下の節へずり落ちる（振り子が長くなって揺らしやすい）
        const nx = b.grab.target.plugin.next;
        if (b.grab.target.label === 'rope' && nx && ++b.grab.slide > 7) {
          Composite.remove(this.lv.world, c);
          const pa = { x: c.bodyA.position.x + c.pointA.x, y: c.bodyA.position.y + c.pointA.y };
          const nc = Constraint.create({
            bodyA: c.bodyA, pointA: c.pointA, bodyB: nx, pointB: { x: 0, y: 0 },
            length: Math.hypot(pa.x - nx.position.x, pa.y - nx.position.y), stiffness: 0.5, damping: 0.05,
          });
          Composite.add(this.lv.world, nc);
          b.grab.c = nc; b.grab.target = nx; b.grab.slide = 0;
        }
        const pa = { x: c.bodyA.position.x + c.pointA.x, y: c.bodyA.position.y + c.pointA.y };
        const pb = { x: c.bodyB.position.x + c.pointB.x, y: c.bodyB.position.y + c.pointB.y };
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 90) this.releaseGrab(b);
      }
      if (b.lastGrabT > 0) b.lastGrabT--;
      if (b.impaled) {
        // 刺さったまま、ゆっくりトゲを滑り落ちる
        if (b.impaled > IMPALE_FRAMES - 50) Body.setPosition(b.body, { x: b.body.position.x, y: b.body.position.y + 0.35 });
        if (--b.impaled === 0) this.kill(b);
      } else if (b.burnT) {
        if (--b.burnT === 0 || b.body.position.y > lv.L.killY) this.kill(b);   // 黒こげ → 復活
      } else if (b.cannon) {
        // 大砲の中
      } else if (b.hitSpike && b.safeT <= 0) this.impale(b, b.hitSpike);   // 復活・ワープ直後は無敵
      else if (b.body.position.y > lv.L.killY) this.kill(b);
    }

    this.updateDroppers();

    // チェックポイント
    const cps = lv.L.checkpoints;
    for (let i = lv.cp + 1; i < cps.length; i++) {
      if (lv.bunnies.some(b => b.body.position.x > cps[i][0] - 20 && b.body.position.y < cps[i][1] + 150)) {
        lv.cp = i; this.events.push(['c', i]);
      }
    }

    // ゴール
    if (this.clearT > 0) {
      if (--this.clearT === 0) {
        if (this.allClear) { this.totalFrames = 0; this.load(0); }
        else this.load(lv.idx + 1);
        return;
      }
    } else {
      const [gx, gy] = lv.L.carrot;
      if (lv.bunnies.some(b => Math.hypot(b.body.position.x - gx, b.body.position.y - gy) < 48)) {
        this.allClear = lv.idx === LEVELS.length - 1;
        this.clearT = this.allClear ? 420 : 170;
        this.events.push(['W', this.allClear ? 1 : 0, this.totalFrames]);
      } else {
        this.totalFrames++;
      }
    }
    this.frame++;
  }

  // 落ちてくるトゲ：真下付近に猫が来るとゆれて、落ちる。しばらくすると元の位置に戻る
  updateDroppers() {
    for (const d of this.lv.droppers) {
      const body = d.body;
      if (d.state === 'idle') {
        const near = this.lv.bunnies.some(b => !b.impaled && b.safeT <= 0 && Math.abs(b.body.position.x - d.x) < d.range && b.body.position.y > d.y);
        if (near) { d.state = 'warn'; d.t = 22; this.events.push(['w', Math.round(d.x), Math.round(d.y)]); }
      } else if (d.state === 'warn') {
        Body.setPosition(body, { x: d.x + ((d.t % 4) < 2 ? -2.5 : 2.5), y: d.y });
        if (--d.t <= 0) {
          Body.setPosition(body, { x: d.x, y: d.y });
          Body.setStatic(body, false);
          Body.setVelocity(body, { x: 0, y: 4 });
          d.state = 'fall'; d.t = 0;
        }
      } else if (d.state === 'fall') {
        if (++d.t > 40 && Math.hypot(body.velocity.x, body.velocity.y) < 0.4) { d.state = 'rest'; d.t = 300; }
      } else if (d.state === 'rest') {
        const held = this.lv.bunnies.some(b => (b.grab && b.grab.target === body) || b.stuckSpike === body);
        if (held) d.t = 300;
        else if (--d.t <= 0) {
          // 元の位置に戻す
          Body.setStatic(body, true);
          Body.setAngle(body, Math.PI);
          Body.setPosition(body, { x: d.x, y: d.y });
          d.state = 'idle';
          this.events.push(['r', Math.round(d.x), Math.round(d.y)]);
        }
      }
    }
  }

  control(b, inp) {
    const body = b.body, m = inp.mask;
    if (b.impaled || b.cannon || b.burnT) { b.lastJc = inp.jc; b.lastWc = inp.wc || 0; b.lastTc = inp.tc || 0; return; }
    if (inp.jc !== b.lastJc) { if (b.lastJc !== null) b.jumpBuf = 8; b.lastJc = inp.jc; }
    const wc = inp.wc || 0;
    if (wc !== b.lastWc) { if (b.lastWc != null) this.warp(b); b.lastWc = wc; }
    const tc = inp.tc || 0;
    if (tc !== b.lastTc) { if (b.lastTc != null) b.throwBuf = 6; b.lastTc = tc; }
    const dir = ((m & IN_R) ? 1 : 0) - ((m & IN_L) ? 1 : 0);
    if (dir) { b.facing = dir; b.moveFacing = dir; }   // moveFacing = 最後に歩いた向き（投げる方向）
    const grounded = b.coyote > 0 && b.jumpCd <= 0;
    let vx = body.velocity.x, vy = body.velocity.y, av = body.angularVelocity;
    const a = wrapAngle(body.angle);

    if (!grounded) body.friction = 0;
    const onIce = grounded && b.groundBody && b.groundBody.label === 'ice';
    if (b.inWater) {
      // 泳ぐ：ジャンプ長押しで浮き、離すとゆっくり沈む
      vx += (dir * 2.8 - vx) * 0.12;
      const up = (m & IN_J) ? -3 : 1.2;
      vy += (up - vy) * ((m & IN_J) ? 0.18 : 0.06);
      av += -a * 0.02 - av * 0.1;
      body.friction = 0;
      // 水面近くでジャンプを押していたら 飛び出す
      if ((m & IN_J) && body.position.y < b.waterTop + 22 && b.jumpCd <= 0) {
        vy = -8.8; b.jumpCd = 20; b.jumping = true;
        this.events.push(['j', b.id, 0]);
      }
    } else if (onIce) {
      // 氷：ゆっくりしか加速・減速できない
      vx += dir * ICE_ACC;
      if (!dir) vx *= 0.997;
      vx = Math.max(-ICE_MAX, Math.min(ICE_MAX, vx));
      body.friction = 0;
      av += (dir * 0.1 - a) * 0.05 - av * 0.2;
    } else if (b.grab && !grounded) {
      vx += dir * 0.17;          // ぶら下がり中は左右でゆらす
      av *= 0.97;
    } else if (grounded) {
      const holding = b.grab && b.grab.target.label === 'bunny';
      const target = dir * (holding ? 2.6 : 3.6);
      vx += (target - vx) * (dir ? 0.22 : 0.12);
      // 歩く時は滑らせ、止まる時は踏ん張る（相棒を持っている時はより強く）
      body.friction = dir ? (holding ? 0.3 : 0) : (holding ? 1 : 0.7);
      av += (dir * 0.18 - a) * 0.05 - av * 0.2;   // 起き上がり（進行方向へ少し前傾）
    } else {
      if (dir && vx * dir < 4.2) vx += dir * 0.25;
      av += -a * 0.006 - av * 0.02;
    }

    if (b.jumpBuf > 0) {
      if (b.grab && b.grab.canJump) {
        const fromRope = b.grab.target.label === 'rope';
        this.releaseGrab(b);
        if (fromRope) { vy = Math.min(vy, 0) - 7; vx += dir * 3.5; }  // ロープからは横っ飛び
        else { vy = -10.6; vx += dir * 2.5; }                         // ペグからは大ジャンプ
        b.jumpBuf = 0; b.jumpCd = 8; b.grabCd = 10; b.jumping = true;
        this.events.push(['j', b.id, 1]);
      } else if (grounded && !b.inWater) {
        vy = -9.2;
        if (dir && !onIce) vx = dir * Math.max(Math.abs(vx), 4.6);   // 斜めジャンプ（氷の上では勢いそのまま）
        const gb = b.groundBody;
        if (gb && !gb.isStatic) {
          const k = Math.min(1, body.mass / gb.mass) * 4;
          Body.setVelocity(gb, { x: gb.velocity.x, y: gb.velocity.y + k });
        }
        b.coyote = 0; b.jumpBuf = 0; b.jumpCd = 8; b.jumping = true;
        this.events.push(['j', b.id, 0]);
      }
    }
    b.jumpBuf--; b.jumpCd--;
    if (b.jumping && !(m & IN_J) && vy < -3) { vy *= 0.55; b.jumping = false; }
    if (vy >= 0) b.jumping = false;

    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, av);

    if (!(m & IN_G)) { if (b.grab) this.releaseGrab(b); }
    else if (!b.grab && b.grabCd <= 0) this.tryGrab(b);
    b.grabCd--;
    if (b.throwBuf > 0) {
      b.throwBuf--;
      if (b.grab && canThrow(b.grab.target)) { this.throwHeld(b, dir); b.throwBuf = 0; }
    }
    if (b.grab) {
      const tb = b.grab.c.bodyB, t = tb.position;
      if (Math.abs(t.x - body.position.x) > 4) b.facing = t.x > body.position.x ? 1 : -1;
      // 地面に立って相棒をつかんでいる時は、踏ん張って引っぱり上げる
      if (tb.label === 'bunny' && b.coyote > 0 && b.groundBody && b.groundBody !== tb && b.groundBody.label !== 'bunny' && tb.plugin.bunny.coyote < 6) {
        const dx = body.position.x - t.x, dy = body.position.y - 20 - t.y, d = Math.hypot(dx, dy) || 1;
        const g = tb.mass * 0.001;
        Body.applyForce(tb, t, { x: dx / d * g * 0.5, y: -g * 0.9 + dy / d * g * 0.5 });
      }
    }
  }

  tryGrab(b) {
    const p = b.body.position;
    let best = null, bestD = REACH, bestT = null;
    for (const t of this.lv.grabbables) {
      if (t === b.body) continue;
      if (t.label === 'looseSpike' && t.isStatic) continue; // 吊り下がり中・刺さっている最中のトゲ
      if (t.plugin.bunny && t.plugin.bunny.cannon) continue; // 大砲の中
      if (b.lastGrabT > 0 && (t.plugin.group || t.id) === b.lastGrab) continue;
      if (Math.abs(t.position.x - p.x) > 400 || Math.abs(t.position.y - p.y) > 400) continue;
      const r = closestPointOnBody(t, p);
      if (r.dist < bestD) { bestD = r.dist; best = r.point; bestT = t; }
    }
    if (!bestT) return;
    let dx = best.x - p.x, dy = best.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const hand = Math.min(20, d);
    const c = Constraint.create({
      bodyA: b.body, pointA: { x: dx / d * hand, y: dy / d * hand },
      bodyB: bestT, pointB: { x: best.x - bestT.position.x, y: best.y - bestT.position.y },
      length: Math.max(3, d - hand), stiffness: 0.5, damping: 0.05,
    });
    Composite.add(this.lv.world, c);
    b.grab = { c, target: bestT, slide: 0, canJump: bestT.label === 'peg' || bestT.label === 'rope' };
    this.events.push(['g', b.id]);
  }

  // つかんでいる物を投げる（相棒・箱・トゲ）
  throwHeld(b, dir) {
    const t = b.grab.target, body = b.body;
    const f = dir || b.moveFacing || 1;
    this.releaseGrab(b);
    b.grabCd = 20;
    const v = t.label === 'looseSpike'
      ? { x: f * 12 + body.velocity.x * 0.4, y: -3.5 }               // トゲは低く鋭く
      : { x: f * THROW_VX + body.velocity.x * 0.4, y: THROW_VY };
    // 投げる物を自分の頭の少し前へ持ってきてから放る
    const hx = body.position.x + f * 22, hy = body.position.y - 46;
    if (t.label === 'looseSpike') Body.setPosition(t, { x: body.position.x + f * 34, y: body.position.y - 4 }); // トゲは胸の高さから
    else if (t.label !== 'bunny') Body.setPosition(t, { x: hx, y: hy });
    else Body.setPosition(t, { x: t.position.x + (hx - t.position.x) * 0.5, y: Math.min(t.position.y, hy) });
    Body.setVelocity(t, v);
    t.plugin.thrownUntil = this.frame + 150;   // 投げられた物はトランポリンで高く跳ぶ
    if (t.label === 'looseSpike') {
      Body.setAngle(t, Math.atan2(v.x, -v.y));   // 先端を飛ぶ方向へ
      Body.setAngularVelocity(t, 0.02 * f);
      t.plugin.owner = b.id; t.plugin.ownerUntil = this.frame + 30;
    } else {
      Body.setAngularVelocity(t, 0.1 * f);
    }
    if (t.label === 'bunny') {
      const ob = t.plugin.bunny;
      ob.coyote = 0; ob.jumpCd = 14; ob.jumping = false;
      if (ob.grab && ob.grab.target === body) this.releaseGrab(ob);   // 投げられた相棒がこちらをつかんでいたら離す
    }
    Body.setVelocity(body, { x: body.velocity.x - f * 1.2, y: body.velocity.y });
    this.events.push(['t', b.id]);
  }

  releaseGrab(b) {
    if (!b.grab) return;
    Composite.remove(this.lv.world, b.grab.c);
    b.lastGrab = b.grab.target.plugin.group || b.grab.target.id;
    b.lastGrabT = 30;
    b.grab = null;
  }

  // トゲに刺さる：その場に固定して、しばらくしてから復活
  impale(b, p) {
    const body = b.body;
    this.releaseGrab(b);
    const dx = p.x - body.position.x, dy = p.y - body.position.y, d = Math.hypot(dx, dy) || 1;
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    body.collisionFilter.mask = ~CAT_SPIKE;                               // トゲが体を貫通できるように
    Body.setPosition(body, { x: body.position.x + dx / d * 10, y: body.position.y + dy / d * 10 }); // 深く刺さる
    Body.setStatic(body, true);
    // 刺さったトゲも猫ごとその場に固定する
    if (b.hitBy && !b.hitBy.isStatic) {
      const sp = b.hitBy;
      sp.plugin.stuck = true;
      for (const o of this.lv.bunnies) if (o.grab && o.grab.target === sp) this.releaseGrab(o);
      Body.setVelocity(sp, { x: 0, y: 0 }); Body.setAngularVelocity(sp, 0);
      Body.setStatic(sp, true);
      b.stuckSpike = sp;
    }
    b.impaled = IMPALE_FRAMES;
    b.jumping = false;
    this.events.push(['i', b.id, Math.round(p.x), Math.round(p.y)]);
  }

  // トゲ・相棒と重ならない出現位置を探す（x だけずらす）
  safeSpot(b, x0, y) {
    const others = this.lv.bunnies.filter(o => o !== b).map(o => o.body);
    const blockers = [...this.lv.hazards, ...others];
    for (const dx of [0, 40, -40, 80, -80, 120, -120, 160, -160]) {
      const x = x0 + dx;
      const bounds = { min: { x: x - 24, y: y - 36 }, max: { x: x + 24, y: y + 60 } };
      if (Matter.Query.region(blockers, bounds).length === 0) return x;
    }
    return x0;
  }

  // 相棒のところへワープ
  warp(b) {
    const o = this.lv.bunnies[1 - b.id];
    if (b.impaled || o.impaled || b.cannon || o.cannon || b.warpCd > 0 || this.clearT > 0) return;
    const from = { x: Math.round(b.body.position.x), y: Math.round(b.body.position.y) };
    this.releaseGrab(b);
    if (o.grab && o.grab.target === b.body) this.releaseGrab(o);
    const p = o.body.position;
    Body.setPosition(b.body, { x: p.x, y: p.y - 66 });   // 相棒の頭の上に出る
    Body.setVelocity(b.body, { x: o.body.velocity.x, y: Math.min(0, o.body.velocity.y) });
    Body.setAngle(b.body, 0);
    Body.setAngularVelocity(b.body, 0);
    b.safeT = 40; b.warpCd = WARP_COOLDOWN; b.jumping = false;
    this.events.push(['p', b.id, from.x, from.y, Math.round(p.x), Math.round(p.y - 66)]);
  }

  kill(b) {
    const lv = this.lv;
    if (b.body.isStatic) Body.setStatic(b.body, false);
    if (b.stuckSpike) { Body.setStatic(b.stuckSpike, false); b.stuckSpike.plugin.stuck = false; b.stuckSpike = null; }
    b.body.collisionFilter.mask = 0xFFFFFFFF;
    b.impaled = 0;
    b.burnT = 0;
    this.events.push(['d', b.id, Math.round(b.body.position.x), Math.round(Math.min(b.body.position.y, lv.L.killY))]);
    this.releaseGrab(b);
    for (const o of lv.bunnies) if (o.grab && o.grab.target === b.body) this.releaseGrab(o);
    const [cx, cy] = lv.L.checkpoints[lv.cp];
    const x = this.safeSpot(b, cx + (b.id ? 30 : -30), cy - 20);
    Body.setPosition(b.body, { x, y: cy - 20 });
    b.safeT = SAFE_FRAMES;
    Body.setVelocity(b.body, { x: 0, y: 0 });
    Body.setAngle(b.body, 0);
    Body.setAngularVelocity(b.body, 0);
    b.coyote = 0; b.jumping = false;
    this.events.push(['s', b.id]);
  }

  // 描画・送信用のスナップショット
  snapshot() {
    const lv = this.lv;
    const p = [];
    for (const d of lv.dyn) {
      const b = d.body;
      p.push(Math.round(b.position.x * 10) / 10, Math.round(b.position.y * 10) / 10, Math.round(b.angle * 1000) / 1000);
    }
    const g = [];
    for (const b of lv.bunnies) {
      if (!b.grab) continue;
      const c = b.grab.c;
      g.push(b.id,
        Math.round(c.bodyA.position.x + c.pointA.x), Math.round(c.bodyA.position.y + c.pointA.y),
        Math.round(c.bodyB.position.x + c.pointB.x), Math.round(c.bodyB.position.y + c.pointB.y));
    }
    return {
      t: 's', f: this.frame, L: lv.idx, ep: this.epoch, p, g,
      k: lv.bunnies.map(b => b.facing),
      im: lv.bunnies.map(b => b.impaled),
      th: lv.bunnies.map(b => (b.grab && canThrow(b.grab.target)) ? 1 : 0),
      sf: lv.bunnies.map(b => b.safeT > 0 && !b.impaled ? 1 : 0),
      sw: lv.gm.switches.map(s => s.pressed ? 1 : 0),
      wd: lv.gm.winds.map(w => w.on ? 1 : 0),
      cn: lv.bunnies.map(b => b.cannon ? 1 : 0),
      bt: lv.bunnies.map(b => b.burnT ? 1 : 0),
      fl: lv.gm.flames.map(f => f.state),
      c: lv.cp,
      w: this.clearT > 0 ? (this.allClear ? 2 : 1) : 0,
      tm: this.totalFrames,
    };
  }
}
