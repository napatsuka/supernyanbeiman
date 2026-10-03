'use strict';
// 追加ギミックの描画（スイッチ・扉・動く足場・トランポリン・崩れる足場・回転ノコギリ）

// 位置が変わらない物（ステージデータから描く）
Renderer.prototype.drawGimmicksStatic = function (ctx, L, state, dt) {
  // ノコギリのレール
  for (const [x1, y1, x2, y2] of L.saws || []) {
    if (x1 === x2 && y1 === y2) continue;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(58,42,63,.55)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.fillStyle = '#5a5566'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 動く足場のレール（うっすら）
  for (const [x1, y1, x2, y2] of L.movers || []) {
    ctx.strokeStyle = 'rgba(58,42,63,.18)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.setLineDash([4, 12]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // スイッチ
  (L.switches || []).forEach(([x, gy, id], i) => {
    const on = state.sw && state.sw[i];
    const col = GIMMICK_COLORS[id % GIMMICK_COLORS.length];
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.fillStyle = '#8b8fa3';
    ctx.beginPath(); ctx.roundRect(x - SWITCH_W / 2, gy - 8, SWITCH_W, 10, 4); ctx.fill(); ctx.stroke();
    const h = on ? 4 : 12;
    ctx.fillStyle = on ? col : shade(col);
    ctx.beginPath(); ctx.roundRect(x - SWITCH_W / 2 + 10, gy - 8 - h, SWITCH_W - 20, h + 2, 4); ctx.fill(); ctx.stroke();
    if (on) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time / 120);
      ctx.beginPath(); ctx.ellipse(x, gy - 14, SWITCH_W * 0.6, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
  // トランポリン
  this.trampSquash = this.trampSquash || [];
  (L.tramps || []).forEach(([x, gy, w], i) => {
    const sq = this.trampSquash[i] || 0;
    this.trampSquash[i] = sq * Math.pow(0.85, dt / 16.7);
    const top = gy - TRAMP_H + Math.sin((1 - sq) * Math.PI * 3) * sq * 10;
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    // 脚
    ctx.fillStyle = '#5a5566';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.roundRect(x + sx * (w / 2 - 10) - 4, gy - TRAMP_H + 6, 8, TRAMP_H - 6, 3); ctx.fill(); ctx.stroke(); }
    // バネ
    ctx.strokeStyle = '#c9cfdc'; ctx.lineWidth = 2;
    for (let k = -2; k <= 2; k++) {
      const bx = x + k * (w / 6);
      ctx.beginPath();
      for (let j = 0; j <= 6; j++) ctx.lineTo(bx + (j % 2 ? 4 : -4), gy - 4 - (gy - 4 - top) * j / 6);
      ctx.stroke();
    }
    // マット
    ctx.fillStyle = '#ff5d73'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - w / 2, top - 6, w, 10, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let k = -w / 2 + 12; k < w / 2 - 6; k += 24) { ctx.fillRect(x + k, top - 4, 10, 6); }
  });
};

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(c * 0.75);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// 動くギミック（スナップショットの姿勢から描く）
Renderer.prototype.drawGimmickBody = function (ctx, dd, x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  if (dd.kind === 'door') {
    const col = GIMMICK_COLORS[dd.id % GIMMICK_COLORS.length];
    const w = dd.w, h = dd.h;
    ctx.fillStyle = '#6f7386';
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col;
    for (let k = -h / 2 + 18; k < h / 2 - 10; k += 46) { ctx.fillRect(-w / 2 + 4, k, w - 8, 12); }
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -h / 2 + 4); ctx.lineTo(0, h / 2 - 4); ctx.stroke();
  } else if (dd.kind === 'mover') {
    const w = dd.w, h = dd.h;
    ctx.fillStyle = '#7b8196';
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 6); ctx.fill(); ctx.stroke();
    // しま模様
    ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, 7, 3); ctx.clip();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = INK;
    for (let k = -w / 2 - 10; k < w / 2; k += 16) { ctx.beginPath(); ctx.moveTo(k, -h / 2 + 10); ctx.lineTo(k + 8, -h / 2); ctx.lineTo(k + 14, -h / 2); ctx.lineTo(k + 6, -h / 2 + 10); ctx.fill(); }
    ctx.restore();
    if (dd.id != null) {
      ctx.fillStyle = GIMMICK_COLORS[dd.id % GIMMICK_COLORS.length];
      ctx.beginPath(); ctx.arc(0, 4, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else if (dd.kind === 'crumble') {
    const w = dd.w, h = dd.h;
    ctx.fillStyle = '#b9a68e';
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
    // れんが目地とひび
    ctx.strokeStyle = 'rgba(58,42,63,.45)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = -w / 2 + 28; k < w / 2; k += 28) { ctx.moveTo(k, -h / 2); ctx.lineTo(k, 0); ctx.moveTo(k - 14, 0); ctx.lineTo(k - 14, h / 2); }
    ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
    ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-w / 4, -h / 2); ctx.lineTo(-w / 4 + 6, -2); ctx.lineTo(-w / 4 - 2, h / 2);
    ctx.moveTo(w / 5, -h / 2); ctx.lineTo(w / 5 - 5, 4); ctx.stroke();
  } else if (dd.kind === 'saw') {
    const r = dd.r, teeth = 14;
    ctx.fillStyle = '#d7dbe6';
    ctx.beginPath();
    for (let k = 0; k < teeth * 2; k++) {
      const ang = k / (teeth * 2) * Math.PI * 2, rr = k % 2 ? r * 0.8 : r;
      ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#a3a8b8';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(58,42,63,.5)'; ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) { const ang = k * 2.09; ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r * 0.2, Math.sin(ang) * r * 0.2); ctx.lineTo(Math.cos(ang) * r * 0.5, Math.sin(ang) * r * 0.5); ctx.stroke(); }
    ctx.fillStyle = '#5a5566'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
};

// ---------- 風・水・氷・大砲・浮いた地面 ----------
Renderer.prototype.drawEnvStatic = function (ctx, L, state) {
  // 浮いた地面
  for (const [x1, x2, top, bottom] of L.blocks || []) {
    ctx.fillStyle = '#a8714a'; ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(x1, top, x2 - x1, bottom - top, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#97633f';
    for (let y = top + 30; y < bottom - 10; y += 40) for (let x = x1 + 24; x < x2 - 14; x += 60) { ctx.beginPath(); ctx.ellipse(x, y, 11, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#6fd36a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x1 - 3, top - 5, x2 - x1 + 6, 16, 6); ctx.fill(); ctx.stroke();
  }
  // 氷の床
  for (const [x1, x2, y] of L.ices || []) {
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 6);
    g.addColorStop(0, '#e9fbff'); g.addColorStop(1, '#9fdcf5');
    ctx.fillStyle = g; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x1, y - 10, x2 - x1, 16, 5); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = x1 + 20; x < x2 - 30; x += 70) { ctx.moveTo(x, y - 6); ctx.lineTo(x + 22, y - 6); ctx.moveTo(x + 30, y - 3); ctx.lineTo(x + 38, y - 3); }
    ctx.stroke();
  }
  // 風の吹き出し口と風のすじ
  (L.winds || []).forEach(([x, gy, w, top, id], i) => {
    const on = !state.wd || state.wd[i];
    ctx.fillStyle = '#5a5566'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x - w / 2, gy - 14, w, 16, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = id != null ? GIMMICK_COLORS[id % GIMMICK_COLORS.length] : '#c9cfdc'; ctx.lineWidth = 3;
    ctx.beginPath(); for (let k = x - w / 2 + 10; k < x + w / 2 - 4; k += 12) { ctx.moveTo(k, gy - 11); ctx.lineTo(k + 6, gy - 3); } ctx.stroke();
    if (!on) return;
    const h = gy - top;
    ctx.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const t = ((this.time * 0.35 + k * h / 9 + (k * 37) % 50) % h);
      const yy = gy - 14 - t, xx = x - w / 2 + 12 + ((k * 53) % (w - 24)) + Math.sin(this.time / 200 + k) * 6;
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - t / h)})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - 26); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(220,240,255,.12)';
    ctx.fillRect(x - w / 2, top, w, h - 14);
  });
  // 大砲
  (L.cannons || []).forEach(([x, gy, deg], i) => {
    const py = gy - CANNON_PIVOT_Y, r = deg * Math.PI / 180;
    const loaded = state.cn && state.cn.some((v, k) => v && Math.hypot(state.p[k * 3] - x, state.p[k * 3 + 1] - py) < 6);
    const sh = loaded ? (Math.random() - 0.5) * 3 : 0;
    ctx.save(); ctx.translate(x + sh, py); ctx.rotate(-r);
    ctx.fillStyle = '#3d3a45'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-26, -22, 104, 44, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a5566';
    ctx.beginPath(); ctx.roundRect(66, -26, 18, 52, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(4, -22, 10, 44); ctx.strokeRect(4, -22, 10, 44);
    ctx.restore();
    // 車輪と台
    ctx.fillStyle = '#a8692b'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 34, gy); ctx.lineTo(x - 18, py); ctx.lineTo(x + 18, py); ctx.lineTo(x + 34, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a4b2a';
    ctx.beginPath(); ctx.arc(x, gy - 16, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, gy - 16, 4, 0, Math.PI * 2); ctx.fill();
    if (loaded) { ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.arc(x, py - 30, 6 + Math.sin(this.time / 50) * 2, 0, Math.PI * 2); ctx.fill(); }
  });
};

// 水（猫より手前に半透明で重ねる）
Renderer.prototype.drawWaterOverlay = function (ctx, L) {
  for (const [x1, x2, top, bottom] of L.waters || []) {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, 'rgba(90,180,255,.45)'); g.addColorStop(1, 'rgba(30,90,200,.7)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x1, bottom);
    for (let x = x1; x <= x2; x += 16) ctx.lineTo(x, top + Math.sin(x / 40 + this.time / 300) * 4);
    ctx.lineTo(x2, bottom); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = x1; x <= x2; x += 16) { const y = top + Math.sin(x / 40 + this.time / 300) * 4; x === x1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  }
};

// 炎の噴き出し口と炎
Renderer.prototype.drawFlames = function (ctx, L, state) {
  (L.flames || []).forEach(([x, y, len, deg], i) => {
    const st = state.fl ? state.fl[i] : 0;
    const r = (deg ?? 90) * Math.PI / 180;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-r + Math.PI / 2);   // ローカル座標で -y 方向が炎の向き
    // 炎
    if (st === 2) {
      const t = this.time / 60;
      for (const [w, col, k] of [[FLAME_W * 1.5, 'rgba(232,58,32,.9)', 1], [FLAME_W, 'rgba(255,140,30,.95)', 0.9], [FLAME_W * 0.5, 'rgba(255,230,120,1)', 0.72]]) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(-w, -6);
        const n = 8;
        for (let j = 1; j <= n; j++) { const yy = -6 - len * k * j / n, ww = w * (1 - j / n * 0.7) + Math.sin(t * 3 + j * 1.7) * 4; ctx.lineTo(-ww, yy); }
        ctx.lineTo(0, -6 - len * k - 10);
        for (let j = n; j >= 1; j--) { const yy = -6 - len * k * j / n, ww = w * (1 - j / n * 0.7) + Math.cos(t * 3 + j * 1.3) * 4; ctx.lineTo(ww, yy); }
        ctx.lineTo(w, -6); ctx.closePath(); ctx.fill();
      }
    } else if (st === 1) {
      // もうすぐ噴き出す：火の粉がちらちら
      ctx.fillStyle = Math.floor(this.time / 80) % 2 ? '#ffb02e' : '#ff5d3a';
      for (let j = 0; j < 4; j++) { ctx.beginPath(); ctx.arc(Math.sin(this.time / 90 + j * 2) * 10, -12 - ((this.time / 6 + j * 9) % 30), 3, 0, Math.PI * 2); ctx.fill(); }
    }
    // 噴き出し口
    ctx.fillStyle = '#4a4552'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-22, -10, 44, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = st ? '#ff5d3a' : '#2b2730';
    ctx.beginPath(); ctx.roundRect(-14, -12, 28, 6, 3); ctx.fill(); ctx.stroke();
    ctx.restore();
  });
};
