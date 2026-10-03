'use strict';
// 入力（タッチ＋キーボード）。プレイヤー別に {mask, jc, tc} を返す。jc / tc はジャンプ / 投げるを押した回数。
// タッチ操作は画面上の操作セット（.controls）ごとに独立していて、1台で2人の時は左右に1セットずつ出す。
const Input = (() => {
  const newTouch = () => ({ dir: 0, jump: false, up: false, grab: false, throwOn: false, latchDir: 0, latchUntil: 0, jc: 0, tc: 0, wc: 0, throwable: false, throwEl: null });
  const touches = [newTouch(), newTouch()];   // [1つ目の操作セット, 2つ目の操作セット]
  const keys = new Set();
  const jc = [0, 0];  // キーボード [1組目, 2組目] のジャンプ回数
  const tcs = [0, 0]; // キーボード [1組目, 2組目] の投げる回数
  const wcs = [0, 0]; // キーボード [1組目, 2組目] のワープ回数

  const SET = [
    { l: ['KeyA'], r: ['KeyD'], j: ['KeyW', 'Space'], g: ['KeyS', 'ShiftLeft'], t: ['KeyE'], w: ['KeyQ'] },
    { l: ['ArrowLeft'], r: ['ArrowRight'], j: ['ArrowUp'], g: ['ArrowDown', 'ShiftRight', 'Slash'], t: ['Period', 'Numpad0', 'Enter'], w: ['KeyP', 'Numpad1'] },
  ];
  const allCodes = new Set(SET.flatMap(s => [...s.l, ...s.r, ...s.j, ...s.g, ...s.t, ...s.w]));

  addEventListener('keydown', e => {
    if (!allCodes.has(e.code) || document.activeElement?.tagName === 'INPUT') return;
    e.preventDefault();
    if (!e.repeat) SET.forEach((s, i) => { if (s.j.includes(e.code)) jc[i]++; if (s.t.includes(e.code)) tcs[i]++; if (s.w.includes(e.code)) wcs[i]++; });
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function keyMask(i) {
    const s = SET[i], has = a => a.some(c => keys.has(c));
    return (has(s.l) ? IN_L : 0) | (has(s.r) ? IN_R : 0) | (has(s.j) ? IN_J : 0) | (has(s.g) ? IN_G : 0);
  }
  function touchMask(p) {
    const t = touches[p];
    // 斜めジャンプは短いタップでも向きが伝わるよう、少しの間だけ向きを保持する
    const dir = t.dir || (performance.now() < t.latchUntil ? t.latchDir : 0);
    return (dir < 0 ? IN_L : 0) | (dir > 0 ? IN_R : 0) | (t.jump || t.up ? IN_J : 0) | (t.grab ? IN_G : 0);
  }
  function merge(...ms) {
    let m = ms.reduce((a, b) => a | b, 0);
    if ((m & IN_L) && (m & IN_R)) m &= ~(IN_L | IN_R);
    return m;
  }

  // 操作セット1つ分（十字キー＋つかむ＋ジャンプ）を有効にする
  function setupSet(root, touch) {
    // 十字キー：上の段 = ジャンプ（左上・右上は斜めジャンプ）、下の段 = 左右移動、真ん中下 = 投げる。指をすべらせてもOK
    const pad = root.querySelector('.pad');
    touch.throwEl = root.querySelector('.throw');
    const cells = {};
    pad.querySelectorAll('.arrow').forEach(el => { cells[el.dataset.c] = el; });
    const ptrs = new Map();
    const update = () => {
      const r = pad.getBoundingClientRect();
      let dir = 0, up = false, thr = false;
      for (const [x, y] of ptrs.values()) {
        const col = x < r.left + r.width / 3 ? -1 : x > r.right - r.width / 3 ? 1 : 0;
        const top = y < r.top + r.height * 0.44;
        if (col) dir = col;
        if (top) up = true;
        if (!col && !top) thr = true;
      }
      if (thr && touch.throwable && !touch.throwOn) { touch.tc++; if (navigator.vibrate) navigator.vibrate(15); }
      touch.throwOn = thr;
      touch.throwEl.classList.toggle('on', thr && touch.throwable);
      if (up && !touch.up) {   // 上に入った瞬間にジャンプ
        touch.jc++;
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
    button(root.querySelector('.btn.jump'), 'jump', () => touch.jc++);
    button(root.querySelector('.btn.grab'), 'grab');
    button(root.querySelector('.warp'), 'warpOn', () => touch.wc++);
    root.addEventListener('contextmenu', e => e.preventDefault());
    // タッチの既定動作（拡大・スクロール・長押しメニュー）を止める。pointer イベントはそのまま届く
    for (const t of ['touchstart', 'touchmove', 'touchend']) root.addEventListener(t, e => e.preventDefault(), { passive: false });
  }

  return {
    setupTouch() {
      document.querySelectorAll('.controls').forEach(root => setupSet(root, touches[+root.dataset.p || 0]));
    },
    // つかんでいる物が投げられる時だけ「投げる」ボタンを出す（p = 操作セット番号）
    setThrowable(p, v) {
      const t = touches[p];
      if (v === t.throwable || !t.throwEl) return;
      t.throwable = v;
      t.throwEl.classList.toggle('show', v);
    },
    // 1台で2人：P1 = キー1組目＋左の操作セット、P2 = キー2組目＋右の操作セット
    local2p() {
      return [0, 1].map(p => ({ mask: merge(keyMask(p), touchMask(p)), jc: jc[p] + touches[p].jc, tc: tcs[p] + touches[p].tc, wc: wcs[p] + touches[p].wc }));
    },
    // オンライン：自分1人分（すべての入力をまとめる）
    single() {
      return {
        mask: merge(keyMask(0), keyMask(1), touchMask(0)),
        jc: jc[0] + jc[1] + touches[0].jc,
        tc: tcs[0] + tcs[1] + touches[0].tc,
        wc: wcs[0] + wcs[1] + touches[0].wc,
      };
    },
  };
})();
