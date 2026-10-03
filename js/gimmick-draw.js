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
