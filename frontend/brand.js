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
