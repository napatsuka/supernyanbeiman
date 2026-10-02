'use strict';
// 入力（タッチ＋キーボード）。プレイヤー別に {mask, jc} を返す。jc はジャンプを押した回数。
const Input = (() => {
  const touch = { dir: 0, jump: false, grab: false };
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
    return (touch.dir < 0 ? IN_L : 0) | (touch.dir > 0 ? IN_R : 0) | (touch.jump ? IN_J : 0) | (touch.grab ? IN_G : 0);
  }
  function merge(...ms) {
    let m = ms.reduce((a, b) => a | b, 0);
    if ((m & IN_L) && (m & IN_R)) m &= ~(IN_L | IN_R);
    return m;
  }

  function setupTouch() {
    const pad = document.getElementById('pad');
    const arrows = pad.querySelectorAll('.arrow');
    const ptrs = new Map();
    const update = () => {
      const r = pad.getBoundingClientRect(), mid = r.left + r.width / 2;
      let dir = 0;
      for (const x of ptrs.values()) dir = x < mid ? -1 : 1;
      touch.dir = dir;
      arrows[0].classList.toggle('on', dir < 0);
      arrows[1].classList.toggle('on', dir > 0);
    };
    pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e.clientX); update(); });
    pad.addEventListener('pointermove', e => { if (ptrs.has(e.pointerId)) { ptrs.set(e.pointerId, e.clientX); update(); } });
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
    document.getElementById('controls').addEventListener('contextmenu', e => e.preventDefault());
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
