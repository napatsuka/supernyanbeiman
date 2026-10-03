'use strict';
// 入力（タッチ＋キーボード）。プレイヤー別に {mask, jc} を返す。jc はジャンプを押した回数。
const Input = (() => {
  const touch = { dir: 0, jump: false, up: false, grab: false, latchDir: 0, latchUntil: 0 };
  const keys = new Set();
  const jc = [0, 0, 0]; // [キー1組目, キー2組目, タッチ]

  const SET = [
    { l: ['KeyA'], r: ['KeyD'], j: ['KeyW', 'Space'], g: ['KeyS', 'ShiftLeft'] },
    { l: ['ArrowLeft'], r: ['ArrowRight'], j: ['ArrowUp'], g: ['ArrowDown', 'ShiftRight', 'Slash'] },
  ];
  const allCodes = new Set(SET.flatMap(s => [...s.l, ...s.r, ...s.j, ...s.g]));

  addEventListener('keydown', e => {
    if (!allCodes.has(e.code) || document.activeElement?.tagName === 'INPUT') return;
    e.preventDefault();
    if (!e.repeat) SET.forEach((s, i) => { if (s.j.includes(e.code)) jc[i]++; });
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function keyMask(i) {
    const s = SET[i], has = a => a.some(c => keys.has(c));
    return (has(s.l) ? IN_L : 0) | (has(s.r) ? IN_R : 0) | (has(s.j) ? IN_J : 0) | (has(s.g) ? IN_G : 0);
  }
  function touchMask() {
    // 斜めジャンプは短いタップでも向きが伝わるよう、少しの間だけ向きを保持する
    const dir = touch.dir || (performance.now() < touch.latchUntil ? touch.latchDir : 0);
    return (dir < 0 ? IN_L : 0) | (dir > 0 ? IN_R : 0) | (touch.jump || touch.up ? IN_J : 0) | (touch.grab ? IN_G : 0);
  }
  function merge(...ms) {
    let m = ms.reduce((a, b) => a | b, 0);
    if ((m & IN_L) && (m & IN_R)) m &= ~(IN_L | IN_R);
    return m;
  }

  function setupTouch() {
    // 十字キー：上の段 = ジャンプ（左上・右上は斜めジャンプ）、下の段 = 左右移動。指をすべらせてもOK
    const pad = document.getElementById('pad');
    const cells = {};
    pad.querySelectorAll('.arrow').forEach(el => { cells[el.dataset.c] = el; });
    const ptrs = new Map();
    const update = () => {
      const r = pad.getBoundingClientRect();
      let dir = 0, up = false;
      for (const [x, y] of ptrs.values()) {
        const col = x < r.left + r.width / 3 ? -1 : x > r.right - r.width / 3 ? 1 : 0;
        const top = y < r.top + r.height * 0.44;
        if (col) dir = col;
        if (top) up = true;
      }
      if (up && !touch.up) {   // 上に入った瞬間にジャンプ
        jc[2]++;
        if (dir) { touch.latchDir = dir; touch.latchUntil = performance.now() + 250; }
      }
      touch.dir = dir; touch.up = up;
      const on = { ul: up && dir < 0, u: up && !dir, ur: up && dir > 0, l: !up && dir < 0, r: !up && dir > 0 };
      for (const k in cells) cells[k].classList.toggle('on', !!on[k]);
    };
    pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); update(); });
    pad.addEventListener('pointermove', e => { if (ptrs.has(e.pointerId)) { ptrs.set(e.pointerId, [e.clientX, e.clientY]); update(); } });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(t, e => { ptrs.delete(e.pointerId); update(); });

    const button = (el, key, onPress) => {
      const ptrs = new Set();
      const set = () => { touch[key] = ptrs.size > 0; el.classList.toggle('on', touch[key]); };
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); el.setPointerCapture(e.pointerId);
        if (!ptrs.size && onPress) onPress();
        ptrs.add(e.pointerId); set();
        if (navigator.vibrate) navigator.vibrate(8);
      });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, e => { ptrs.delete(e.pointerId); set(); });
    };
    button(document.getElementById('bJump'), 'jump', () => jc[2]++);
    button(document.getElementById('bGrab'), 'grab');
    const ctl = document.getElementById('controls');
    ctl.addEventListener('contextmenu', e => e.preventDefault());
    // タッチの既定動作（拡大・スクロール・長押しメニュー）を止める。pointer イベントはそのまま届く
    for (const t of ['touchstart', 'touchmove', 'touchend']) ctl.addEventListener(t, e => e.preventDefault(), { passive: false });
  }

  return {
    setupTouch,
    // 1台で2人：P1 = キー1組目＋タッチ、P2 = キー2組目
    local2p() {
      return [
        { mask: merge(keyMask(0), touchMask()), jc: jc[0] + jc[2] },
        { mask: merge(keyMask(1)), jc: jc[1] },
      ];
    },
    // オンライン：自分1人分（すべての入力をまとめる）
    single() {
      return { mask: merge(keyMask(0), keyMask(1), touchMask()), jc: jc[0] + jc[1] + jc[2] };
    },
  };
})();
