// Kafe adı, slogan ve renk temasını uygular (hem müşteri hem barista sayfası kullanır).
// Önce tarayıcıdaki son kopya kullanılır (anında görünür), sonra sunucudan güncellenir.
(function () {
  const CACHE_KEY = "brandCache";
  const pageTitle = document.body.dataset.title || "";

  function titleFor(pending) {
    const name = (window.Brand.data && window.Brand.data.cafeName) || "";
    const base = [pageTitle, name].filter(Boolean).join(" · ");
    return pending ? `(${pending}) ${base}` : base;
  }

  function apply(settings) {
    window.Brand.data = settings;
    document.documentElement.dataset.theme = settings.theme || "kahve";
    document.querySelectorAll("[data-brand-name]").forEach((e) => { e.textContent = settings.cafeName; });
    document.querySelectorAll("[data-brand-tagline]").forEach((e) => {
      e.textContent = settings.tagline;
      e.hidden = !settings.tagline;
    });
    document.querySelectorAll("[data-brand-mark]").forEach((e) => {
      e.textContent = (settings.cafeName || "K").trim().charAt(0).toLocaleUpperCase("tr-TR");
    });
    document.title = titleFor(window.Brand.pending);
  }

  window.Brand = {
    data: null,
    pending: 0,
    apply,
    // Sekme başlığını günceller; pending > 0 ise başına (3) gibi sayaç ekler
    setPending(n) {
      window.Brand.pending = n;
      document.title = titleFor(n);
    },
  };

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached && cached.cafeName) apply(cached);
  } catch { /* önbellek yok */ }

  fetch("/api/settings")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((settings) => {
      apply(settings);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch { /* yoksay */ }
    })
    .catch(() => { /* sunucu yoksa varsayılan görünüm kalır */ });
})();

// ---------------------------------------------------------------------------
// Damlalı üst bar: koyu kahve çubuğun altına büyük bir dalga ve ondan sarkan damlalar çizer.
// Şekiller ekran genişliğine göre üretilir (orantı bozulmaz). Sabit bir tohumla üretildiği için
// her açılışta aynı düzen çıkar. Damlaların hareketi style.css içindeki animasyonlardandır.
// ---------------------------------------------------------------------------
(function () {
  // Küçük, tohumlu rastgele sayı üretici (mulberry32)
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dripSvg(width) {
    // Ölçek: dar ekranda damlalar küçülür (CSS'teki --drip-space ile uyumlu)
    const s = width < 640 ? 0.62 : width < 1024 ? 0.82 : 1;
    const rand = seeded(11);
    const maxBottom = 104 * s;                // en uzun damlanın alt sınırı
    const height = Math.ceil(maxBottom + 44 * s); // altta düşen damlacıklara yer
    const n2 = (v) => v.toFixed(1);

    // Büyük, yumuşak dalga: iki sinüsün toplamı
    const wave = (x) =>
      28 * s +
      21 * s * Math.sin((2 * Math.PI * x) / (700 * s) + 0.5) +
      6 * s * Math.sin((2 * Math.PI * x) / (260 * s) + 1.9);

    // Dalga gövdesi (üstü çubuğun içine taşar: kenar erimesi/dikiş görünmesin)
    let body = `M-30,-20 L-30,${n2(wave(-30))}`;
    for (let x = -30; x <= width + 30; x += 8) body += ` L${x},${n2(wave(x))}`;
    body += ` L${width + 30},-20 Z`;

    let shapes = "";
    let glosses = "";
    let falls = "";
    let index = 0;
    for (let x = (36 + rand() * 50) * s; x < width + 10; x += (92 + rand() * 96) * s) {
      const y0 = wave(x);
      const r = (6 + rand() * 4.4) * s;                                    // damla ucu yarıçapı
      const length = Math.max(12 * s, Math.min((24 + rand() * 54) * s, maxBottom - y0 - r));
      const neck = r * 0.52;                                               // boyun yarı genişliği
      const shoulder = neck * 3.4;                                         // dalgaya bağlanan geniş kısım
      const flare = 13 * s;
      const cy = y0 + length;
      const motion =
        `style="transform-origin:${n2(x)}px ${n2(y0)}px;` +
        `animation-duration:${(4.5 + rand() * 3.5).toFixed(2)}s;` +
        `animation-delay:-${(rand() * 6).toFixed(2)}s"`;

      shapes +=
        `<g class="drip" ${motion}>` +
        `<path d="M${n2(x - shoulder)},${n2(y0 - 3)} Q${n2(x - neck)},${n2(y0 - 1)} ${n2(x - neck)},${n2(y0 + flare)} ` +
        `L${n2(x + neck)},${n2(y0 + flare)} Q${n2(x + neck)},${n2(y0 - 1)} ${n2(x + shoulder)},${n2(y0 - 3)} Z"/>` +
        `<rect x="${n2(x - neck)}" y="${n2(y0)}" width="${n2(neck * 2)}" height="${n2(length)}" rx="${n2(neck)}"/>` +
        `<circle cx="${n2(x)}" cy="${n2(cy)}" r="${n2(r)}"/>` +
        `</g>`;

      // Parlak yansıma: damla ucunda küçük bir ışık lekesi (aynı hareketle senkron)
      const gx = x - r * 0.32;
      const gy = cy - r * 0.28;
      glosses +=
        `<g class="drip" ${motion}>` +
        `<ellipse cx="${n2(gx)}" cy="${n2(gy)}" rx="${n2(r * 0.24)}" ry="${n2(r * 0.46)}" transform="rotate(18 ${n2(gx)} ${n2(gy)})"/>` +
        `</g>`;

      // Bazı damlalardan küçük damlacıklar düşer
      if (index % 3 === 1) {
        falls +=
          `<circle class="fall" cx="${n2(x)}" cy="${n2(cy + r * 1.1)}" r="${n2(r * 0.5)}" ` +
          `style="animation-duration:${(5 + rand() * 3).toFixed(2)}s;animation-delay:-${(rand() * 6).toFixed(2)}s"/>`;
      }
      index += 1;
    }

    // "Gooey" filtre: bulanıklaştırıp eşikleyerek dalga ve damlaları sıvı gibi birbirine kaynaştırır
    return (
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" focusable="false">` +
      `<defs><filter id="dripGoo" filterUnits="userSpaceOnUse" x="-60" y="-40" width="${width + 120}" height="${height + 60}" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${(4.5 * s).toFixed(1)}" result="blur"/>` +
      `<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/>` +
      `</filter></defs>` +
      `<g class="goo" filter="url(#dripGoo)"><path d="${body}"/>${shapes}</g>` +
      `<g class="gloss">${glosses}</g>` +
      `<g class="falls">${falls}</g>` +
      `</svg>`
    );
  }

  function renderDrips() {
    const width = document.documentElement.clientWidth;
    document.querySelectorAll("body > .app-header").forEach((header) => {
      let box = header.querySelector(":scope > .header-drips");
      if (!box) {
        box = document.createElement("div");
        box.className = "header-drips";
        box.setAttribute("aria-hidden", "true");
        header.appendChild(box);
      }
      if (box.dataset.width === String(width)) return;
      box.dataset.width = String(width);
      box.innerHTML = dripSvg(width);
    });
  }

  renderDrips();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderDrips, 150);
  });
})();
