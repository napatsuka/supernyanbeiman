'use strict';
// CPU の相棒（1台で遊ぶ時に 2P を動かす）
//  ・相棒（プレイヤー）の少し後ろをついて歩く。段差はジャンプ、小さな谷は跳びこえる
//  ・トゲ・ノコギリ・炎・落ちてくるトゲの手前では止まる（氷の上ではブレーキ）
//  ・相棒が扉・エレベーター・風のそばにいたら、同じ色のスイッチに乗って押さえておく
//  ・はぐれたり、行けない所に相棒がいる時はワープで追いつく
//  ・相棒につかまれている時と、頭に乗られている時はじっとする（投げてもらえる）
class CpuBuddy {
  constructor(id) {
    this.id = id;
    this.reset();
  }

  reset() {
    this.jc = 0; this.wc = 0; this.hold = 0; this.jumpWait = 0;
    this.lastX = null; this.stuck = 0; this.below = 0; this.blocked = 0; this.waitWarp = 0;
  }

  out(mask) { return { mask, jc: this.jc, tc: 0, wc: this.wc }; }

  jump() { if (this.jumpWait <= 0) { this.jc++; this.hold = 18; this.jumpWait = 30; } }

  warp() { this.wc++; this.stuck = 0; this.below = 0; this.blocked = 0; this.waitWarp = 0; }

  input(sim) {
    const lv = sim.lv, me = lv.bunnies[this.id], pa = lv.bunnies[1 - this.id];
    const mb = me.body, pb = pa.body;
    const mx = mb.position.x, my = mb.position.y, px = pb.position.x, py = pb.position.y;
    if (this.jumpWait > 0) this.jumpWait--;
    let jHeld = this.hold > 0; if (this.hold > 0) this.hold--;

    if (me.impaled || me.cannon || me.burnT || sim.clearT > 0) { this.lastX = mx; return this.out(0); }
    // 相棒につかまれている・頭に乗られている → じっとする
    if ((pa.grab && pa.grab.target === mb) || pa.groundBody === mb) { this.lastX = mx; this.stuck = 0; return this.out(0); }

    const grounded = me.coyote > 0;
    const partnerBusy = pa.impaled || pa.cannon || pa.burnT;

    // ---- 目的地を決める（スイッチ係 or 相棒の後ろ）----
    const duty = partnerBusy ? null : this.findDuty(lv, me, pa);
    let tx;
    if (duty) tx = duty.x;
    else tx = px - 55 * Math.sign(px - mx || 1);
    let dir = Math.abs(tx - mx) > (duty ? 8 : 26) ? Math.sign(tx - mx) : 0;

    // ---- 水の中：相棒の高さへ泳ぐ ----
    if (me.inWater) {
      let m = (dir < 0 ? IN_L : dir > 0 ? IN_R : 0);
      if (py < my + 10) m |= IN_J;   // 相棒が上なら浮く
      return this.finish(sim, me, pa, m, dir, mx, my, px, py, duty);
    }

    // ---- 危ないものを避ける ----
    const vx = mb.velocity.x;
    const avoid = this.dangerAround(lv, sim, me);   // 近くのノコギリ・揺れているトゲから逃げる向き
    if (avoid) dir = avoid;
    else if (dir) {
      const danger = this.dangerAhead(lv, sim, me, dir);
      if (danger === 'gap') {
        // 跳びこえられる谷ならジャンプ、無理なら止まる
        if (grounded && this.landingAhead(lv, me, dir)) this.jump();
        else if (!jHeld) dir = 0;
      } else if (danger) dir = 0;
    }
    // 氷の上で危ない方へ滑っていたらブレーキ
    const onIce = grounded && me.groundBody && me.groundBody.label === 'ice';
    if (onIce && vx && !dir && this.dangerAhead(lv, sim, me, Math.sign(vx))) dir = -Math.sign(vx);

    // ---- 段差：前に壁があればジャンプ ----
    if (dir && grounded && this.wallAhead(lv, me, dir)) this.jump();

    let m = (dir < 0 ? IN_L : dir > 0 ? IN_R : 0);
    if (this.hold > 0) m |= IN_J;
    return this.finish(sim, me, pa, m, dir, mx, my, px, py, duty);
  }

  // ワープの判断をしてから入力を返す
  finish(sim, me, pa, m, dir, mx, my, px, py, duty) {
    const dist = Math.hypot(px - mx, py - my);
    // 進めていない
    if (dir && this.lastX !== null && Math.abs(mx - this.lastX) < 0.6) this.stuck++; else this.stuck = Math.max(0, this.stuck - 2);
    // 相棒がずっと上にいる（崖の上など）
    if (py < my - 140 && Math.abs(px - mx) < 280) this.below++; else this.below = 0;
    // 危ないので止まっているが、相棒は先にいる
    if (!dir && !duty && Math.abs(px - mx) > 140) this.blocked++; else this.blocked = 0;
    this.lastX = mx;

    const partnerStable = !pa.impaled && !pa.cannon && !pa.burnT && !pa.inWater
      && (pa.coyote > 0 || (pa.grab && pa.grab.target.isStatic));
    const want = !duty && (dist > 650 || (this.stuck > 70 && dist > 110) || this.below > 80 || this.blocked > 45);
    if (want) this.waitWarp++; else this.waitWarp = 0;
    if (want && partnerStable && me.warpCd <= 0 && this.waitWarp > 5) this.warp();
    return this.out(m);
  }

  // 扉・エレベーター・風のそばに相棒がいたら、同じ色のスイッチを押さえる
  findDuty(lv, me, pa) {
    const g = lv.gm;
    if (!g.switches.length) return null;
    const mp = me.body.position, pp = pa.body.position;
    const needs = [];
    for (const d of g.doors) if (!(d.all && d.latched)) needs.push({ id: d.id, x: d.x });
    for (const mv of g.movers) if (mv.id != null) needs.push({ id: mv.id, x: mv.body.position.x });
    for (const w of g.winds) if (w.id != null) needs.push({ id: w.id, x: w.x });
    let best = null;
    for (const n of needs) {
      if (Math.abs(pp.x - n.x) > 480) continue;
      // 相棒がもう反対側へ渡り終えていたら不要
      const side = Math.sign(mp.x - n.x) || -1;
      if (Math.sign(pp.x - n.x) !== side && Math.abs(pp.x - n.x) > 110) continue;
      for (const s of g.switches) {
        if (s.id !== n.id) continue;
        if (Math.abs(s.x - mp.x) > 700 || Math.abs((s.gy - 30) - mp.y) > 70) continue;   // 同じ高さにあるスイッチだけ
        if (Math.abs(s.x - pp.x) < 40 && Math.abs((s.gy - 30) - pp.y) < 50) continue;   // 相棒が乗っている方は除く
        const d = Math.abs(s.x - mp.x);
        if (!best || d < best.d) best = { x: s.x, d };
      }
    }
    return best;
  }

  solids(lv) {
    return Matter.Composite.allBodies(lv.world).filter(b => b.isStatic && !b.isSensor && b.label !== 'spike' && b.label !== 'looseSpike' && b.label !== 'bunny');
  }

  // 前方の危険：'gap'（足元が無い）、true（トゲなど）、null（安全）
  dangerAhead(lv, sim, me, dir) {
    const p = me.body.position;
    const fx = p.x + dir * 40;
    const ground = Matter.Query.ray(this.solids(lv), { x: fx, y: p.y }, { x: fx, y: p.y + 260 }, 6);
    const box = { min: { x: Math.min(p.x + dir * 18, p.x + dir * 100), y: p.y - 70 }, max: { x: Math.max(p.x + dir * 18, p.x + dir * 100), y: p.y + 45 } };
    if (Matter.Query.region(lv.hazards.filter(h => h !== undefined), box).length) return true;
    if (this.flameIn(lv, box)) return true;
    for (const d of lv.droppers) if (d.state !== 'idle' && d.state !== 'rest' && Math.abs(d.x - (p.x + dir * 50)) < 70) return true;
    if (!ground.length) return 'gap';
    return null;
  }

  // 近くの動く危険物（ノコギリ・揺れているトゲ）から逃げる向き
  dangerAround(lv, sim, me) {
    const p = me.body.position;
    for (const s of lv.gm.saws) {
      const q = s.body.position;
      if (Math.abs(q.x - p.x) < 95 && Math.abs(q.y - p.y) < 90) return Math.sign(p.x - q.x) || 1;
    }
    for (const d of lv.droppers) {
      if ((d.state === 'warn' || d.state === 'fall') && Math.abs(d.x - p.x) < 55 && d.body.position.y < p.y) return Math.sign(p.x - d.x) || 1;
    }
    return 0;
  }

  hazardNear(lv, sim, x, y, r) {
    const box = { min: { x: x - 40, y: y - 40 }, max: { x: x + 40, y: y + 40 } };
    return Matter.Query.region(lv.hazards, box).length ? true : null;
  }

  flameIn(lv, box) {
    for (const f of lv.gm.flames) {
      if (f.state === 0) continue;
      const ex = f.x + f.dx * f.len, ey = f.y + f.dy * f.len;
      const fb = { min: { x: Math.min(f.x, ex) - 30, y: Math.min(f.y, ey) - 30 }, max: { x: Math.max(f.x, ex) + 30, y: Math.max(f.y, ey) + 30 } };
      if (fb.min.x < box.max.x && fb.max.x > box.min.x && fb.min.y < box.max.y && fb.max.y > box.min.y) return true;
    }
    return false;
  }

  // 走りジャンプで届く所に安全な足場があるか
  landingAhead(lv, me, dir) {
    const p = me.body.position;
    for (const d of [120, 160, 200]) {
      const fx = p.x + dir * d;
      const hit = Matter.Query.ray(this.solids(lv), { x: fx, y: p.y - 60 }, { x: fx, y: p.y + 60 }, 6);
      if (hit.length) {
        const box = { min: { x: fx - 30, y: p.y - 80 }, max: { x: fx + 30, y: p.y + 60 } };
        if (!Matter.Query.region(lv.hazards, box).length) return true;
      }
    }
    return false;
  }

  // 目の前に越えられそうな壁があるか（体の高さの少し先）
  wallAhead(lv, me, dir) {
    const p = me.body.position;
    const box = { min: { x: Math.min(p.x + dir * 20, p.x + dir * 34), y: p.y - 10 }, max: { x: Math.max(p.x + dir * 20, p.x + dir * 34), y: p.y + 20 } };
    return Matter.Query.region(this.solids(lv), box).length > 0;
  }
}
