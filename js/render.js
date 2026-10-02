'use strict';
// 描画（ホスト・クライアント共通。スナップショットの姿勢配列から描く）
const INK = '#3a2a3f';
const CAT_COLORS = [
  // 1P: 黒猫
  { fur: '#2e2a33', paw: '#3b3641', inner: '#ff9fb8', belly: null, stripe: null, eye: '#ffd23f', line: '#9a93a3', tipColor: null, tag: '#7b5cff', puff: '#4a4452' },
  // 2P: 茶トラ
  { fur: '#ffb45e', paw: '#fff4e4', inner: '#ff9fb0', belly: '#fff4e4', stripe: '#e07f2a', eye: null, line: INK, tipColor: '#e07f2a', tag: '#ff8c2e', puff: '#ffb45e' },
];
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 300, z: 1, init: false };
    this.particles = [];
    this.ears = [0, 1].map(() => ({ a: 0, v: 0, prev: null }));
    this.banner = null;
    this.level = null;
    this.time = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
  }

  setLevel(lv) {
    this.level = lv;
    this.cam.init = false;
    this.particles = [];
    this.ears.forEach(e => { e.prev = null; e.a = 0; e.v = 0; });
    this.showBanner(`STAGE ${lv.idx + 1}`, lv.L.name, 2.2);
  }

  showBanner(title, sub, dur) { this.banner = { title, sub, t: 0, dur }; }

  burst(x, y, color, n = 12, speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 1, r: 4 + Math.random() * 6, color });
    }
  }

  // state: { p, g, k, c, w, tm }, localId: 自分の猫（-1 なら両方追う）
  draw(state, localId, dt) {
    const ctx = this.ctx, lv = this.level;
    this.time += dt;
    if (!lv || !state) return;
    const P = state.p;
    const bun = [0, 1].map(i => ({ x: P[i * 3], y: P[i * 3 + 1], a: P[i * 3 + 2] }));

    this.updateCamera(bun, localId, dt);
    const { x: cx, y: cy, z } = this.cam;
    const W = this.W, H = this.H, d = this.dpr;

    this.drawBackground(ctx, cx, cy, z);

    ctx.setTransform(d * z, 0, 0, d * z, d * (W / 2 - cx * z), d * (H / 2 - cy * z));
    const view = { l: cx - W / 2 / z - 50, r: cx + W / 2 / z + 50, t: cy - H / 2 / z - 50, b: cy + H / 2 / z + 50 };

    this.drawAbyss(ctx, lv.L.killY, view);
    for (const s of lv.L.signs || []) this.drawSign(ctx, s);
    this.drawCheckpoints(ctx, lv.L.checkpoints, state.c);
    this.drawGoal(ctx, lv.L.carrot);
    for (const s of lv.L.seesaws || []) this.drawFulcrum(ctx, s, lv.L);
    for (const g of lv.L.ground) if (g[1] > view.l && g[0] < view.r) this.drawGround(ctx, g, view);
    for (const s of lv.L.spikes || []) this.drawSpikes(ctx, s);
    for (const p of lv.L.pegs || []) this.drawPeg(ctx, p);

    // 動く物体
    let rope = [];
    lv.dyn.forEach((dd, i) => {
      if (dd.kind === 'bunny') return;
      const x = P[i * 3], y = P[i * 3 + 1], a = P[i * 3 + 2];
      if (dd.kind === 'rope') {
        if (dd.first && rope.length) { this.drawRope(ctx, rope); rope = []; }
        if (dd.first) rope.anchor = dd.anchor;
        rope.push({ x, y, a });
      } else if (dd.kind === 'crate') this.drawCrate(ctx, x, y, a, dd.w);
      else if (dd.kind === 'plank') this.drawPlank(ctx, x, y, a, dd.w, dd.h);
    });
    if (rope.length) this.drawRope(ctx, rope);

    // 猫
    const grabs = {};
    for (let i = 0; i < state.g.length; i += 5) grabs[state.g[i]] = state.g.slice(i + 1, i + 5);
    for (const i of [1, 0]) this.drawCat(ctx, i, bun[i], state.k[i], grabs[i], i === localId, dt);

    this.drawParticles(ctx, dt);

    // 画面座標のHUD
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (this.hud) this.drawHud(ctx, state, dt);
  }

  drawWaiting(text) {
    const ctx = this.ctx;
    this.drawBackground(ctx, this.cam.x, this.cam.y, this.cam.z);
    ctx.font = `800 18px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = INK; ctx.fillText(text, this.W / 2, this.H / 2);
  }

  updateCamera(bun, localId, dt) {
    const W = this.W, H = this.H, cam = this.cam;
    const base = Math.min(W / 900, H / 520);
    const minZ = base * 0.6, maxZ = base * 1.05;
    const dx = Math.abs(bun[0].x - bun[1].x) + 320, dy = Math.abs(bun[0].y - bun[1].y) + 300;
    const fitZ = Math.min(W / dx, H / dy);
    const z = Math.max(minZ, Math.min(maxZ, fitZ));
    let tx = (bun[0].x + bun[1].x) / 2, ty = (bun[0].y + bun[1].y) / 2;
    if (localId >= 0 && fitZ < minZ) {
      // 2人が画面に収まらない時は自分寄りに
      const me = bun[localId];
      const k = Math.min(1, (minZ - fitZ) / minZ * 3);
      tx += (me.x - tx) * k * 0.8; ty += (me.y - ty) * k * 0.8;
    }
    ty -= 30 / z;
    if (!cam.init) { cam.x = tx; cam.y = ty; cam.z = z; cam.init = true; return; }
    const f = 1 - Math.pow(0.88, dt / 16.7);
    cam.x += (tx - cam.x) * f; cam.y += (ty - cam.y) * f; cam.z += (z - cam.z) * f * 0.6;
  }

  drawBackground(ctx, cx, cy, z) {
    const W = this.W, H = this.H, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#79c8ff'); g.addColorStop(0.7, '#c8ecff'); g.addColorStop(1, '#fff3d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 太陽
    ctx.fillStyle = 'rgba(255,240,170,.9)';
    ctx.beginPath(); ctx.arc(W * 0.82, H * 0.2, Math.min(W, H) * 0.08, 0, Math.PI * 2); ctx.fill();
    // 雲
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 6; i++) {
      const span = W + 400;
      const x = ((i * 397 - cx * 0.08 * z + this.time * 0.006 * (1 + i % 3)) % span + span) % span - 200;
      const y = H * (0.1 + (i * 0.137) % 0.35);
      const s = 0.7 + (i % 3) * 0.25;
      ctx.beginPath();
      ctx.ellipse(x, y, 60 * s, 20 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 30 * s, y + 4, 34 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 26 * s, y - 8 * s, 36 * s, 22 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 遠景の丘（パララックス）
    const hills = [[0.15, '#a9dfb0', 0.62, 70, 0.004], [0.3, '#86cf91', 0.74, 55, 0.007]];
    for (const [par, col, hy, amp, freq] of hills) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, H);
      const off = cx * par * z, yoff = (cy - 300) * par * 0.4 * z;
      for (let x = 0; x <= W + 20; x += 20) {
        const wx = x + off;
        ctx.lineTo(x, H * hy - yoff - Math.sin(wx * freq) * amp - Math.sin(wx * freq * 2.3 + 1) * amp * 0.4);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }

  drawAbyss(ctx, killY, v) {
    const g = ctx.createLinearGradient(0, killY - 260, 0, killY + 40);
    g.addColorStop(0, 'rgba(40,30,80,0)'); g.addColorStop(1, 'rgba(40,30,80,.85)');
    ctx.fillStyle = g;
    ctx.fillRect(v.l, killY - 260, v.r - v.l, 300);
    ctx.fillStyle = 'rgba(40,30,80,.85)';
    ctx.fillRect(v.l, killY + 39, v.r - v.l, Math.max(0, v.b - killY));
  }

  drawGround(ctx, [x1, x2, top], v) {
    const bottom = Math.min(GROUND_BOTTOM, v.b + 50);
    if (bottom <= top) return;
    ctx.fillStyle = '#a8714a';
    ctx.fillRect(x1, top, x2 - x1, bottom - top);
    // 地層の模様
    ctx.fillStyle = '#97633f';
    for (let y = top + 50; y < bottom; y += 46) {
      for (let x = x1 + ((y / 46) % 2) * 30 + 14; x < x2 - 14; x += 64) {
        ctx.beginPath(); ctx.ellipse(x, y, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 縁取り
    ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, bottom); ctx.lineTo(x1, top); ctx.lineTo(x2, top); ctx.lineTo(x2, bottom);
    ctx.stroke();
    // 草
    ctx.fillStyle = '#6fd36a';
    ctx.beginPath();
    ctx.moveTo(x1 - 4, top - 4);
    for (let x = x1 - 4; x <= x2 + 4; x += 16) ctx.lineTo(Math.min(x, x2 + 4), top - 4 - ((x / 16) % 2 ? 3 : 0));
    ctx.lineTo(x2 + 4, top + 12);
    for (let x = x2 + 4; x >= x1 - 4; x -= 22) ctx.quadraticCurveTo(x - 11, top + 22, Math.max(x - 22, x1 - 4), top + 12);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 3; ctx.stroke();
  }

  drawSpikes(ctx, [x1, x2, y]) {
    ctx.fillStyle = '#c9cfdc'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = x1; x < x2; x += 24) { ctx.moveTo(x, y); ctx.lineTo(x + 12, y - 24); ctx.lineTo(x + 24, y); }
    ctx.fill(); ctx.stroke();
  }

  drawPeg(ctx, [x, y]) {
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff6c2';
    ctx.beginPath(); ctx.arc(x - 3, y - 3, 3, 0, Math.PI * 2); ctx.fill();
    // ほのかな光
    const pulse = 0.25 + 0.15 * Math.sin(this.time / 300 + x);
    ctx.strokeStyle = `rgba(255,210,63,${pulse})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.stroke();
  }

  drawRope(ctx, segs) {
    const a = segs.anchor;
    // 吊り元
    ctx.fillStyle = '#7a4b2a'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(a.x - 26, a.y - 10, 52, 14, 6); ctx.fill(); ctx.stroke();
    const pts = [a];
    for (const s of segs) pts.push({ x: s.x - Math.sin(s.a) * 11, y: s.y + Math.cos(s.a) * 11 });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = 9;
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    ctx.strokeStyle = '#d9a35f'; ctx.lineWidth = 5; ctx.stroke();
    const e = pts[pts.length - 1];
    ctx.fillStyle = '#d9a35f'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  drawCrate(ctx, x, y, a, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const h = s / 2;
    ctx.fillStyle = '#e0a458'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-h, -h, s, s, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#a8692b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-h + 7, -h + 7); ctx.lineTo(h - 7, h - 7); ctx.moveTo(h - 7, -h + 7); ctx.lineTo(-h + 7, h - 7); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.strokeRect(-h + 5, -h + 5, s - 10, s - 10);
    ctx.restore();
  }

  drawPlank(ctx, x, y, a, w, h) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#c98b4f'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawFulcrum(ctx, [x, y], L) {
    const gy = L.ground.find(g => x >= g[0] && x <= g[1]);
    const by = gy ? gy[2] : y + 40;
    ctx.fillStyle = '#8b8fa3'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 22, by); ctx.lineTo(x + 22, by); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  drawSign(ctx, [x, gy, text]) {
    const lines = text.split('\n');
    ctx.font = `800 15px ${FONT}`;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 26;
    const h = lines.length * 20 + 16;
    const top = gy - 70 - h;
    ctx.fillStyle = '#8a5a35'; ctx.fillRect(x - 4, top + h - 2, 8, gy - (top + h) + 2);
    ctx.fillStyle = '#fff4dc'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - w / 2, top, w, h, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x, top + 18 + i * 20));
  }

  drawCheckpoints(ctx, cps, active) {
    for (let i = 1; i < cps.length; i++) {
      const [x, y] = cps[i];
      const gy = y + 40, on = i <= active;
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - 90); ctx.stroke();
      const wave = Math.sin(this.time / 200 + i) * 4;
      ctx.fillStyle = on ? '#ff7aa8' : '#c8c0c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + 2, gy - 90); ctx.quadraticCurveTo(x + 22, gy - 86 + wave, x + 42, gy - 78); ctx.lineTo(x + 2, gy - 62); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  drawGoal(ctx, [x, y]) {
    const bob = Math.sin(this.time / 250) * 6;
    ctx.save(); ctx.translate(x, y + bob); ctx.rotate(Math.sin(this.time / 400) * 0.2 - 0.25);
    const glow = ctx.createRadialGradient(0, 0, 5, 0, 0, 60);
    glow.addColorStop(0, 'rgba(255,230,120,.7)'); glow.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    // しっぽ
    const wag = Math.sin(this.time / 120) * 4;
    ctx.fillStyle = '#5aa9e6';
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(36, -14 + wag); ctx.lineTo(32, 0); ctx.lineTo(36, 14 + wag); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 背びれ
    ctx.beginPath(); ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-2, -26, 8, -12); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 体
    const g = ctx.createLinearGradient(0, -16, 0, 16);
    g.addColorStop(0, '#5aa9e6'); g.addColorStop(0.55, '#bfe3ff'); g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(-4, 0, 26, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // えら・目
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-14, 0, 9, -0.9, 0.9); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-20, -4, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-21, -4, 2, 0, Math.PI * 2); ctx.fill();
    // きらり
    const tw = (Math.sin(this.time / 180) + 1) / 2;
    ctx.fillStyle = `rgba(255,255,255,${tw})`;
    ctx.beginPath(); ctx.ellipse(4, -6, 6, 2.5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawCat(ctx, id, b, facing, grab, isLocal, dt) {
    const col = CAT_COLORS[id];
    const sw = this.ears[id];
    // しっぽの揺れ（姿勢の変化から推定）
    if (sw.prev && dt > 0) {
      const k = 16.7 / dt;
      const av = wrapAngle(b.a - sw.prev.a) * k;
      const vx = (b.x - sw.prev.x) * k;
      const target = Math.max(-1.2, Math.min(1.2, -av * 4 - vx * 0.08 * (facing || 1))) + Math.sin(this.time / 500 + id * 2) * 0.3;
      sw.v += (target - sw.a) * 0.15;
      sw.v *= 0.8;
      sw.a += sw.v;
    }
    sw.prev = { x: b.x, y: b.y, a: b.a };

    const f = facing || 1;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // しっぽ（体の後ろ）
    const tx = -f * 12, ty = 20, sa = sw.a;
    const ex = tx - f * (16 + sa * 14), ey = ty - 48 - sa * 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.bezierCurveTo(tx - f * 24, ty - 2, tx - f * (28 + sa * 8), ty - 30, ex, ey);
    ctx.lineWidth = 12; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 7; ctx.strokeStyle = col.fur; ctx.stroke();
    if (col.tipColor) {
      ctx.fillStyle = col.tipColor; ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 3;

    // 耳（三角）
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 9, -25);
      ctx.rotate(side * 0.25 + Math.max(-0.3, Math.min(0.3, sa * 0.15)));
      ctx.fillStyle = col.fur;
      ctx.beginPath(); ctx.moveTo(-9, 5); ctx.quadraticCurveTo(-5, -12, 0, -18); ctx.quadraticCurveTo(5, -12, 9, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.inner;
      ctx.beginPath(); ctx.moveTo(-4.5, 3); ctx.lineTo(0, -10); ctx.lineTo(4.5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 足
    ctx.fillStyle = col.paw;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * 9 + f * 3, 28, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    // 胴体
    ctx.fillStyle = col.fur;
    ctx.beginPath(); ctx.roundRect(-18, -30, 36, 60, 17); ctx.fill(); ctx.stroke();
    // しま模様
    if (col.stripe) {
      ctx.strokeStyle = col.stripe; ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-4, -28); ctx.lineTo(-3, -22); ctx.moveTo(0, -29); ctx.lineTo(0, -23); ctx.moveTo(4, -28); ctx.lineTo(3, -22);
      ctx.moveTo(-16, 2); ctx.lineTo(-10, 4); ctx.moveTo(-16, 10); ctx.lineTo(-10, 12);
      ctx.moveTo(16, 2); ctx.lineTo(10, 4); ctx.moveTo(16, 10); ctx.lineTo(10, 12);
      ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
    }
    // お腹
    if (col.belly) {
      ctx.fillStyle = col.belly;
      ctx.beginPath(); ctx.ellipse(f * 2, 14, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 目
    const fx = f * 4;
    for (const side of [-1, 1]) {
      const exx = fx + side * 7, eyy = -13;
      if (col.eye) {
        ctx.fillStyle = col.eye;
        ctx.beginPath(); ctx.ellipse(exx, eyy, 4.3, 4.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(exx + f * 0.6, eyy, 1.4, 3.8, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.ellipse(exx, eyy, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(exx - 1.1, eyy - 1.7, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,120,150,.5)';
    ctx.beginPath(); ctx.ellipse(fx - 12, -5, 3.5, 2.2, 0, 0, Math.PI * 2); ctx.ellipse(fx + 12, -5, 3.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    // 鼻と口（ω）
    ctx.fillStyle = '#ff7f9e';
    ctx.beginPath(); ctx.moveTo(fx - 2.5, -7.5); ctx.lineTo(fx + 2.5, -7.5); ctx.lineTo(fx, -5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col.line; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(fx - 2.2, -4.2, 2.2, 0, Math.PI); ctx.moveTo(fx + 4.4, -4.2); ctx.arc(fx + 2.2, -4.2, 2.2, 0, Math.PI);
    // ひげ
    for (const side of [-1, 1]) {
      ctx.moveTo(fx + side * 10, -7); ctx.lineTo(fx + side * 23, -10);
      ctx.moveTo(fx + side * 10, -4.5); ctx.lineTo(fx + side * 23, -3);
    }
    ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    // 手（つかんでいない時）
    if (!grab) {
      ctx.fillStyle = col.paw;
      ctx.beginPath(); ctx.ellipse(f * 16, 6, 6, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    // つかんでいる腕
    if (grab) {
      const [ax, ay, bx, by] = grab;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = col.fur; ctx.lineWidth = 6; ctx.stroke();
      ctx.fillStyle = col.paw; ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // 名札
    const label = isLocal ? 'YOU' : `${id + 1}P`;
    ctx.font = `800 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 12;
    const ly = b.y - 70;
    ctx.fillStyle = col.tag; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(b.x - tw / 2, ly - 10, tw, 20, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x - 5, ly + 10); ctx.lineTo(b.x, ly + 16); ctx.lineTo(b.x + 5, ly + 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, b.x, ly + 1);
  }

  drawParticles(ctx, dt) {
    const k = dt / 16.7;
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    for (const p of this.particles) {
      p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.15 * k; p.vx *= 0.97; p.life -= 0.025 * k;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter(p => p.life > 0);
  }

  drawHud(ctx, state, dt) {
    const W = this.W, H = this.H;
    // タイム
    const s = Math.floor(state.tm / 60);
    const txt = `STAGE ${this.level.idx + 1}/${LEVELS.length}   ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    ctx.font = `800 15px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(txt).width + 22;
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(12, 12, tw, 30, 15); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.fillText(txt, 23, 28);

    let bn = this.banner;
    const newClear = state.w && !this.lastW;
    this.lastW = state.w;
    if (newClear) {
      const total = Math.floor(state.tm / 60);
      bn = this.banner = state.w === 2
        ? { title: 'ALL CLEAR!', sub: `タイム ${Math.floor(total / 60)}分${total % 60}秒　おつかれさま！`, t: 0, dur: 7, clear: true }
        : { title: 'CLEAR!', sub: 'おさかなゲット！', t: 0, dur: 2.8, clear: true };
    }
    if (bn) {
      bn.t += dt / 1000;
      if (bn.t > bn.dur) { this.banner = null; return; }
      const inT = Math.min(1, bn.t / 0.3), outT = Math.min(1, (bn.dur - bn.t) / 0.3);
      const a = Math.min(inT, outT);
      const sc = 0.6 + 0.4 * (1 - Math.pow(1 - inT, 3)) + (bn.clear ? Math.sin(bn.t * 6) * 0.03 : 0);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, H * 0.32); ctx.scale(sc, sc);
      ctx.textAlign = 'center';
      const big = Math.min(64, W / 9);
      ctx.font = `800 ${big}px ${FONT}`;
      ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = INK;
      ctx.strokeText(bn.title, 0, 0);
      ctx.fillStyle = bn.clear ? '#ffd23f' : '#fff'; ctx.fillText(bn.title, 0, 0);
      ctx.font = `800 ${Math.round(big * 0.38)}px ${FONT}`; ctx.lineWidth = 6;
      ctx.strokeText(bn.sub, 0, big * 0.75); ctx.fillStyle = '#fff'; ctx.fillText(bn.sub, 0, big * 0.75);
      ctx.restore();
    }
  }
}
