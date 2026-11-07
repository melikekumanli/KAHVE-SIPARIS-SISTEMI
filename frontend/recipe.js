// Tarif yardımcıları (müşteri ve personel sayfası ortak kullanır).
// Tarif: [{ name, amount, unit }] — sıra bardağa ALTTAN ÜSTE ekleme sırasıdır.
window.Recipe = (function () {
  // İçerik adına göre renk. Sıra önemli: "süt köpüğü" önce köpüğe, sonra süte uyar.
  const RULES = [
    [/köpü|krema/, "#fbf4e8"], // "köpük" ve "köpüğü" (ğ ile) ikisini de yakalar
    [/espresso|ristretto|cold brew|filtre|türk kahvesi|kahve/, "#3d2415"],
    [/çikolata/, "#6b3a22"],
    [/karamel/, "#c98a3b"],
    [/dondurma/, "#f4e4b8"],
    [/portakal|limon/, "#f0a33c"],
    [/tonik|soda/, "#e3f0ec"],
    [/buz/, "#dcecf5"],
    [/(^|\s)su($|\s)/, "#cfe4ef"],
    [/çay/, "#b5632a"],
    [/süt|yulaf|badem|soya/, "#ecd9bc"],
    [/şurup|sos/, "#d8a05a"],
  ];

  function color(name) {
    const n = String(name).toLocaleLowerCase("tr-TR");
    const hit = RULES.find(([re]) => re.test(n));
    return hit ? hit[1] : "#b9a083";
  }

  // Boyut çarpanıyla ölçekler: ml 5'in katlarına, gram tam sayıya yuvarlanır
  function amount(line, scale = 1) {
    const v = line.amount * scale;
    return line.unit === "g" ? Math.max(1, Math.round(v)) : Math.max(5, Math.round(v / 5) * 5);
  }

  const label = (line, scale) => `${amount(line, scale)} ${line.unit || "ml"}`;

  // "30 ml Espresso · 180 ml Süt · 30 ml Süt köpüğü"
  function summary(recipe, scale = 1) {
    return recipe.map((l) => `${label(l, scale)} ${l.name}`).join(" · ");
  }

  // Sıvı toplam hacim (gram cinsinden olanlar hariç)
  function totalMl(recipe, scale = 1) {
    return recipe.filter((l) => (l.unit || "ml") === "ml").reduce((sum, l) => sum + amount(l, scale), 0);
  }

  // Katmanlı bardak çizimi + içerik listesi + toplam hacim. milkName verilirse "Süt" satırı seçilen süt adıyla yazılır.
  function render(container, recipe, { scale = 1, milkName = "" } = {}) {
    container.replaceChildren();
    const make = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const display = (line) => (milkName && line.name.toLocaleLowerCase("tr-TR") === "süt" ? milkName : line.name);

    const wrap = make("div", "recipe");

    const glass = make("div", "recipe-glass");
    glass.setAttribute("role", "img");
    glass.setAttribute("aria-label", `Bardak içeriği: ${summary(recipe, scale)}`);
    recipe.forEach((line) => {
      const layer = make("div", "recipe-layer");
      layer.style.flexGrow = String(amount(line, scale));
      layer.style.background = color(line.name);
      glass.appendChild(layer); // column-reverse: ilk içerik en altta
    });

    const list = make("ul", "recipe-list");
    [...recipe].reverse().forEach((line) => { // bardakla aynı sırada: üstten alta
      const li = make("li");
      const dot = make("span", "recipe-dot");
      dot.style.background = color(line.name);
      li.append(dot, make("span", "recipe-name", display(line)), make("span", "recipe-amount", label(line, scale)));
      list.appendChild(li);
    });

    wrap.append(glass, list);
    container.appendChild(wrap);

    const ml = totalMl(recipe, scale);
    if (ml > 0) {
      const total = make("div", "recipe-total");
      total.append(make("span", "", "Toplam hacim"), make("strong", "", `≈ ${ml} ml`));
      container.appendChild(total);
    }
  }

  return { color, amount, summary, totalMl, render };
})();
