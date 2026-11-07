// Küçük animasyonlar: başlıktan bardağa damlayan kahve + sepete eklenince espresso çekimi.
(function () {
  "use strict";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- Başlıktan sepet bardağına damlayan damlalar ----
  function cupVisible() {
    const lid = document.querySelector(".cup-lid");
    if (!lid || !lid.offsetParent) return null;
    const r = lid.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
    return r;
  }

  function dropOnce() {
    if (reduced.matches || document.hidden) return;
    const lid = cupVisible();
    const header = document.querySelector(".app-header");
    if (!lid || !header) return;
    const tip = header.querySelector(".cup-drip-tip");
    const tr = tip ? tip.getBoundingClientRect() : null;
    const startY = tr ? Math.max(0, tr.bottom - 10) : Math.max(0, header.getBoundingClientRect().bottom - 6);
    const endY = lid.top + 6;
    if (endY - startY < 40) return;
    const x = tr && tr.width ? tr.left + tr.width / 2 : lid.left + lid.width / 2;

    const drop = document.createElement("div");
    drop.className = "coffee-drop";
    drop.setAttribute("aria-hidden", "true");
    drop.style.left = x - 5 + "px";
    drop.style.top = startY + "px";
    document.body.appendChild(drop);

    const dist = endY - startY;
    const duration = Math.max(650, Math.min(1500, dist * 2.2));
    const fall = drop.animate(
      [
        { transform: "translateY(0) scale(0.2, 0.2)", opacity: 0, offset: 0 },
        { transform: "translateY(0) scale(1, 1.15)", opacity: 1, offset: 0.14 },
        { transform: `translateY(${dist}px) scale(0.9, 1.3)`, opacity: 1, offset: 1 },
      ],
      { duration, easing: "cubic-bezier(.5,0,.9,.6)" }
    );
    fall.onfinish = () => {
      drop.remove();
      splash(x, endY);
    };
  }

  function splash(x, y) {
    const lid = document.querySelector(".cup-lid");
    if (lid) {
      lid.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(2px)" }, { transform: "translateY(0)" }],
        { duration: 260, easing: "ease-out" }
      );
    }
    for (let i = 0; i < 3; i += 1) {
      const p = document.createElement("div");
      p.className = "coffee-splash";
      p.style.left = x - 2 + "px";
      p.style.top = y - 2 + "px";
      document.body.appendChild(p);
      const dx = (i - 1) * 9 + (Math.random() * 4 - 2);
      p.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 0.9 },
          { transform: `translate(${dx}px,-9px) scale(0.8)`, opacity: 0.8, offset: 0.45 },
          { transform: `translate(${dx * 1.6}px,2px) scale(0.3)`, opacity: 0 },
        ],
        { duration: 420, easing: "ease-out" }
      ).onfinish = () => p.remove();
    }
  }

  function scheduleDrop() {
    setTimeout(() => { dropOnce(); scheduleDrop(); }, 2600 + Math.random() * 2400);
  }
  scheduleDrop();

  // ---- Espresso çekimi ----
  const CUP = "M34,92 H86 L81,120 Q80,126 74,126 H46 Q40,126 39,120 Z";
  function espressoSvg() {
    const vapor = (cls, x) =>
      `<path class="fx-vapor ${cls}" d="M${x},86 q-5,-8 0,-15 t0,-14" fill="none" stroke="#a07a58" stroke-width="2.6" stroke-linecap="round"/>`;
    return (
      `<svg viewBox="0 0 120 134" width="120" height="134" xmlns="http://www.w3.org/2000/svg" focusable="false">` +
      `<defs><clipPath id="fxCupClip"><path d="${CUP}"/></clipPath></defs>` +
      `<rect x="14" y="4" width="92" height="28" rx="9" fill="#3a2214"/>` +
      `<rect x="14" y="4" width="92" height="9" rx="6" fill="#5a3722"/>` +
      `<circle cx="30" cy="22" r="4" fill="#e9d8c2"/><circle cx="90" cy="22" r="4" fill="#d9a441" class="fx-lamp"/>` +
      `<rect x="42" y="32" width="36" height="9" rx="3" fill="#8a8f96"/>` +
      `<rect x="76" y="34" width="34" height="6" rx="3" fill="#2c180c"/>` +
      `<rect x="52" y="41" width="5" height="6" rx="1.5" fill="#6d7279"/><rect x="63" y="41" width="5" height="6" rx="1.5" fill="#6d7279"/>` +
      `<rect class="fx-stream" x="53.4" y="47" width="2.4" height="48" rx="1.2" fill="#4a2a14"/>` +
      `<rect class="fx-stream" x="64.2" y="47" width="2.4" height="48" rx="1.2" fill="#4a2a14"/>` +
      `<ellipse cx="60" cy="131" rx="40" ry="3.4" fill="rgba(60,30,10,.18)"/>` +
      `<path d="M86,98 Q104,98 102,108 Q100,118 82,117" fill="none" stroke="#f4efe8" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="${CUP}" fill="#f7f2ea"/>` +
      `<g clip-path="url(#fxCupClip)"><g class="fx-coffee">` +
      `<rect x="30" y="92" width="60" height="40" fill="#3b1f0e"/>` +
      `<rect x="30" y="92" width="60" height="5" fill="#c58a4a"/>` +
      `</g></g>` +
      `<path d="${CUP}" fill="none" stroke="#d9cfc0" stroke-width="1.4"/>` +
      vapor("v1", 50) + vapor("v2", 62) + vapor("v3", 74) +
      `</svg>`
    );
  }

  let espressoEl = null;
  function pullEspresso() {
    if (reduced.matches) return;
    if (espressoEl) espressoEl.remove();
    const box = document.createElement("div");
    box.className = "fx-espresso";
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = espressoSvg() + `<div class="fx-caption">Espresso çekiliyor…</div>`;
    document.body.appendChild(box);
    espressoEl = box;
    setTimeout(() => { if (espressoEl === box) { box.remove(); espressoEl = null; } }, 2600);
    const cup = document.querySelector(".cup");
    if (cup && cup.offsetParent) {
      cup.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.025)", offset: 0.4 }, { transform: "scale(1)" }],
        { duration: 520, delay: 1700, easing: "ease-out" }
      );
    }
  }

  document.addEventListener("cart:add", pullEspresso);
})();
