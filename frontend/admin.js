const $ = (id) => document.getElementById(id);

const loginView = $("loginView");
const panel = $("panel");
const messageEl = $("message");
const soundToggle = $("soundToggle");

const TOKEN_KEY = "adminToken";
const POLL_MS = 4000;
const ARCHIVE_LIMIT = 100;
const DONE = "Teslim Edildi";

// Durum akışı: her aşamanın bir sonraki / önceki adımı ve buton yazısı
const FLOW = {
  "Bekliyor": { next: "Hazırlanıyor", label: "Hazırlamaya başla" },
  "Hazırlanıyor": { next: "Hazır", label: "Hazır", prev: "Bekliyor" },
  "Hazır": { next: DONE, label: "Teslim edildi", prev: "Hazırlanıyor" },
};
const COLUMNS = { "Bekliyor": ["listWait", "countWait"], "Hazırlanıyor": ["listPrep", "countPrep"], "Hazır": ["listReady", "countReady"] };
const THEME_COLORS = { kahve: "#7a4a2b", zeytin: "#4d6b3a", lacivert: "#27487d", bordo: "#8c2f45" };
const THEME_NAMES = { kahve: "Kahve", zeytin: "Zeytin", lacivert: "Lacivert", bordo: "Bordo" };

let token = null;
let menu = { items: [], sizes: [], statuses: [] };
let activeOrders = [];    // teslim edilmemiş siparişler
let archiveOrders = [];   // teslim edilenler (arşiv görünümündeyken yüklenir)
let view = "active";      // "active" | "archive"
let currentTab = "orders";
let range = "today";      // rapor aralığı
let seenOrderIds = null;  // null: ilk yükleme (ses çalma)
let pollTimer = null;
let audioCtx = null;

// Anahtar sadece bu sekme açıkken saklanır (sessionStorage), kalıcı değil.
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* depolama kapalı */ }

// ---------- Yardımcılar ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

let messageTimer;
function showMessage(text, type = "error") {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 5000);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? formatTime(iso)
    : `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} ${formatTime(iso)}`;
}

const formatMoney = (n) => `${Number(n).toLocaleString("tr-TR")} ₺`;
const orderLabel = (o) => (o.number ? `#${o.number}` : "Sipariş");
const serviceLabel = (o) => (o.service === "Masa" ? `Masa ${o.table}` : o.service);
const itemsText = (o) => o.items.map((i) => `${i.qty}× ${i.name} (${i.size})`).join(", ");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-token": token, ...options.headers },
  });
  if (response.status === 401) {
    logout("Yönetici anahtarı geçersiz.");
    throw new Error("unauthorized");
  }
  if (response.status === 429) {
    showMessage("Çok fazla hatalı deneme. Biraz bekleyin.");
    throw new Error("rate-limited");
  }
  return response;
}

// Sunucunun doğrulama mesajlarını kullanıcıya gösterir
async function reportFailure(response, fallback) {
  const body = await response.json().catch(() => ({}));
  showMessage((body.errors && body.errors.join(" ")) || fallback);
}

const isHandled = (error) => ["unauthorized", "rate-limited"].includes(error.message);

// Bir işlemi çalıştırır; ağ hatalarında genel mesaj gösterir
async function attempt(fallback, fn) {
  try {
    return await fn();
  } catch (error) {
    if (!isHandled(error)) showMessage(fallback);
  }
}

function button(text, className, onClick, title) {
  const b = el("button", { type: "button", className: `btn btn-sm ${className}`.trim(), textContent: text });
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

// ---------- Ses ----------
function beep() {
  if (!soundToggle.checked) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    [880, 1175].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.18);
      osc.stop(audioCtx.currentTime + i * 0.18 + 0.17);
    });
  } catch { /* ses desteklenmiyor */ }
}

// Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra açar (sayfa yenilense bile)
document.addEventListener("click", () => {
  try { audioCtx = audioCtx || new AudioContext(); audioCtx.resume(); } catch { /* ses yok */ }
});

// ---------- Oturum ----------
function logout(message) {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* yoksay */ }
  clearInterval(pollTimer);
  pollTimer = null;
  seenOrderIds = null;
  setKitchen(false);
  window.Brand.setPending(0);
  panel.hidden = true;
  $("logoutBtn").hidden = true;
  loginView.hidden = false;
  if (message) showMessage(message);
}

// ---------- Fiş (önizleme + yazdırma) ----------
function buildReceipt(order) {
  const brand = window.Brand.data || {};
  const line = (left, right, cls = "") =>
    el("div", { className: `line ${cls}` }, el("span", { textContent: left }), el("span", { textContent: right }));

  const root = el("div", { className: "receipt-body" });
  root.append(
    el("h1", { textContent: brand.cafeName || "" }),
    ...(brand.tagline ? [el("div", { className: "center", textContent: brand.tagline })] : []),
    el("hr"),
    el("div", { className: "center", textContent: "SİPARİŞ NO" }),
    el("div", { className: "big", textContent: order.number ? `#${order.number}` : "-" }),
    ...(order.service ? [el("div", { className: "center strong", textContent: serviceLabel(order).toLocaleUpperCase("tr-TR") })] : []),
    el("div", { className: "center", textContent: new Date(order.createdAt).toLocaleString("tr-TR") }),
    el("hr"),
    line("Müşteri", order.name),
    el("hr"),
    ...order.items.map((i) => line(`${i.qty}× ${i.name} (${i.size})`, `${i.lineTotal} TL`)),
    ...(order.note ? [el("div", { className: "note", textContent: `Not: ${order.note}` })] : []),
    el("hr"),
    line("TOPLAM", `${order.price} TL`, "total"),
    el("hr"),
    el("div", { className: "center", textContent: "Afiyet olsun!" })
  );
  return root;
}

function showReceipt(order) {
  const receipt = buildReceipt(order);
  $("receiptPreview").replaceChildren(receipt);
  $("receipt").replaceChildren(receipt.cloneNode(true));
  $("receiptDialog").showModal();
}

$("receiptPrint").addEventListener("click", () => window.print());
$("receiptClose").addEventListener("click", () => $("receiptDialog").close());
$("receiptCancel").addEventListener("click", () => $("receiptDialog").close());
$("receiptDialog").addEventListener("click", (e) => { if (e.target === $("receiptDialog")) $("receiptDialog").close(); });

// ---------- Siparişler: pano ----------
function ticket(order) {
  const flow = FLOW[order.status];
  const actions = el("div", { className: "ticket-actions" });
  if (flow) {
    actions.appendChild(button(flow.label, "btn-primary", () => changeStatus(order.id, flow.next)));
    if (flow.prev) actions.appendChild(button("Geri al", "", () => changeStatus(order.id, flow.prev), `"${flow.prev}" durumuna döndür`));
  }
  actions.append(
    button("Fiş", "", () => showReceipt(order)),
    button("Sil", "btn-danger", () => removeOrder(order))
  );

  const who = el("div", { className: "ticket-who" });
  if (order.service) who.appendChild(el("span", { className: `chip ${order.service === "Masa" ? "chip-table" : "chip-takeaway"}`, textContent: serviceLabel(order) }));
  who.appendChild(el("span", { textContent: order.name }));

  return el("li", { className: "ticket" },
    el("div", { className: "ticket-head" },
      el("span", { className: "ticket-no", textContent: orderLabel(order) }),
      el("span", { className: "ticket-time", textContent: formatDateTime(order.createdAt) })),
    who,
    el("ul", { className: "ticket-items" },
      ...order.items.map((i) => el("li", {}, el("b", { textContent: `${i.qty}×` }), ` ${i.name} `, el("span", { textContent: `· ${i.size}` })))),
    ...(order.note ? [el("div", { className: "ticket-note", textContent: `Not: ${order.note}` })] : []),
    el("div", { className: "ticket-total", textContent: formatMoney(order.price) }),
    actions);
}

function renderBoard() {
  Object.entries(COLUMNS).forEach(([status, [listId, countId]]) => {
    // Pano sütununda en eski sipariş en üstte (önce gelen önce hazırlanır)
    const inColumn = activeOrders.filter((o) => o.status === status).reverse();
    const list = $(listId);
    list.innerHTML = "";
    $(countId).textContent = inColumn.length;
    if (!inColumn.length) list.appendChild(el("li", { className: "board-empty", textContent: "Sipariş yok" }));
    inColumn.forEach((o) => list.appendChild(ticket(o)));
  });

  const pending = activeOrders.filter((o) => o.status === "Bekliyor").length;
  $("pendingCount").textContent = pending;
  $("pendingCount").hidden = pending === 0;
  $("kitchenTitle").textContent = `Mutfak ekranı · ${pending} bekleyen`;
  window.Brand.setPending(pending);
  $("summary").textContent = `${activeOrders.length} aktif sipariş`;
}

// ---------- Siparişler: arşiv tablosu ----------
function renderArchive() {
  const body = $("archiveBody");
  body.innerHTML = "";
  $("archiveEmpty").hidden = archiveOrders.length > 0;
  $("summary").textContent = archiveOrders.length
    ? `Son ${archiveOrders.length} teslim edilen sipariş (en fazla ${ARCHIVE_LIMIT})`
    : "";

  archiveOrders.forEach((o) => {
    body.appendChild(el("tr", {},
      el("td", { className: "num-cell", textContent: orderLabel(o) }),
      el("td", { textContent: o.name }),
      el("td", { textContent: o.service ? serviceLabel(o) : "-" }),
      el("td", { textContent: itemsText(o) }),
      el("td", { className: "num", textContent: formatMoney(o.price) }),
      el("td", { textContent: formatDateTime(o.createdAt) }),
      el("td", {}, el("div", { className: "actions" },
        button("Geri al", "", () => changeStatus(o.id, "Hazır"), "Teslime hazır durumuna döndür"),
        button("Fiş", "", () => showReceipt(o)),
        button("Sil", "btn-danger", () => removeOrder(o))))));
  });
}

async function fetchOrders(query) {
  const response = await api(`/api/orders${query}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadOrders() {
  await attempt("Siparişler yüklenemedi.", async () => {
    // Sayaçlar ve ses için her zaman aktif siparişler çekilir (hafif sorgu)
    const active = await fetchOrders("?scope=active");
    if (seenOrderIds && active.some((o) => !seenOrderIds.has(o.id))) beep();
    seenOrderIds = new Set(active.map((o) => o.id));
    activeOrders = active;
    renderBoard();

    if (view === "archive" && currentTab === "orders") {
      archiveOrders = await fetchOrders(`?status=${encodeURIComponent(DONE)}&limit=${ARCHIVE_LIMIT}`);
      renderArchive();
    }
  });
}

async function changeStatus(id, status) {
  await attempt("Durum güncellenemedi.", async () => {
    const response = await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!response.ok) await reportFailure(response, "Durum güncellenemedi.");
  });
  await loadOrders();
}

async function removeOrder(order) {
  if (!confirm(`${orderLabel(order)} - ${order.name} siparişi kalıcı olarak silinsin mi?`)) return;
  await attempt("Sipariş silinemedi.", async () => {
    const response = await api(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) await reportFailure(response, "Sipariş silinemedi.");
  });
  await loadOrders();
}

function setView(next) {
  view = next;
  $("viewActive").classList.toggle("active", next === "active");
  $("viewArchive").classList.toggle("active", next === "archive");
  $("board").hidden = next !== "active";
  $("archiveView").hidden = next !== "archive";
  loadOrders();
}
$("viewActive").addEventListener("click", () => setView("active"));
$("viewArchive").addEventListener("click", () => setView("archive"));

// ---------- Mutfak modu ----------
function setKitchen(on) {
  document.body.classList.toggle("kitchen", on);
  $("kitchenBar").hidden = !on;
  if (on) {
    selectTab("orders");
    if (view !== "active") setView("active");
    $("kitchenSound").checked = soundToggle.checked;
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

$("kitchenBtn").addEventListener("click", () => setKitchen(true));
$("kitchenExit").addEventListener("click", () => setKitchen(false));
$("kitchenSound").addEventListener("change", (e) => { soundToggle.checked = e.target.checked; });
$("fullscreenBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => showMessage("Tam ekran bu tarayıcıda açılamadı."));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("kitchen") && !document.fullscreenElement) setKitchen(false); });

// ---------- Raporlar ----------
function rangeBounds(which) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = (offset) => { const d = new Date(start); d.setDate(d.getDate() + offset); return d; };
  switch (which) {
    case "yesterday": return { from: day(-1), to: day(0) };
    case "7": return { from: day(-6), to: day(1) };
    case "30": return { from: day(-29), to: day(1) };
    default: return { from: day(0), to: day(1) };
  }
}

const rangeQuery = () => {
  const { from, to } = rangeBounds(range);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
};

// CSS ile çizilen çubuk grafik: values = [{ label, value, text }]
function renderBars(container, values, { showValues = true } = {}) {
  container.replaceChildren();
  const max = Math.max(1, ...values.map((v) => v.value));
  values.forEach((v) => {
    const bar = el("div", { className: "bar", style: `height:${Math.max(v.value ? 4 : 0, Math.round((v.value / max) * 100))}%` });
    bar.title = v.text;
    const col = el("div", { className: "bar-col" },
      el("div", { className: "bar-val", textContent: showValues && v.value ? v.shortText ?? String(v.value) : "" }),
      el("div", { className: "bar-track" }, bar),
      el("div", { className: "bar-label", textContent: v.label }));
    col.setAttribute("role", "listitem");
    col.setAttribute("aria-label", v.text);
    container.appendChild(col);
  });
}

function renderReport(r) {
  $("kpiOrders").textContent = r.totals.orders;
  $("kpiRevenue").textContent = formatMoney(r.totals.revenue);
  $("kpiItems").textContent = r.totals.items;
  $("kpiAverage").textContent = formatMoney(r.totals.average);

  const many = r.byDay.length > 14;
  renderBars($("chartDays"), r.byDay.map((d) => {
    const [, m, day] = d.date.split("-");
    return { label: many ? (Number(day) % 5 === 1 ? `${day}.${m}` : "") : `${day}.${m}`, value: d.revenue, shortText: String(d.revenue), text: `${day}.${m}: ${d.orders} sipariş, ${formatMoney(d.revenue)}` };
  }), { showValues: !many });

  renderBars($("chartHours"), r.byHour.map((count, h) => ({
    label: h % 3 === 0 ? String(h).padStart(2, "0") : "",
    value: count,
    text: `${String(h).padStart(2, "0")}:00 - ${count} sipariş`,
  })), { showValues: false });

  const top = $("topList");
  top.replaceChildren();
  if (!r.topItems.length) top.appendChild(el("li", { className: "empty", textContent: "Bu aralıkta satış yok." }));
  const maxQty = Math.max(1, ...r.topItems.map((t) => t.qty));
  r.topItems.forEach((t) => {
    const fill = el("span", { className: "rank-fill" });
    fill.style.width = `${Math.round((t.qty / maxQty) * 100)}%`;
    top.appendChild(el("li", { className: "rank-row" },
      el("div", { className: "rank-head" }, el("span", { className: "rank-name", textContent: t.name }), el("span", { className: "rank-qty", textContent: `${t.qty} adet · ${formatMoney(t.revenue)}` })),
      el("div", { className: "rank-bar" }, fill)));
  });

  const total = r.totals.orders;
  const split = $("serviceSplit");
  split.replaceChildren();
  [["Masa", r.byService.Masa], ["Paket", r.byService.Paket], ["Belirtilmemiş", r.byService.Diğer]]
    .filter(([, n]) => n > 0)
    .forEach(([label, n]) => {
      const pct = total ? Math.round((n / total) * 100) : 0;
      const fill = el("span", { className: "rank-fill" });
      fill.style.width = `${pct}%`;
      split.appendChild(el("div", { className: "rank-row" },
        el("div", { className: "rank-head" }, el("span", { className: "rank-name", textContent: label }), el("span", { className: "rank-qty", textContent: `${n} sipariş · %${pct}` })),
        el("div", { className: "rank-bar" }, fill)));
    });
  if (!total) split.appendChild(el("p", { className: "empty", textContent: "Bu aralıkta sipariş yok." }));
}

async function loadReport() {
  const { from, to } = rangeBounds(range);
  $("rangeLabel").textContent = range === "today" || range === "yesterday"
    ? from.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
    : `${from.toLocaleDateString("tr-TR", { day: "numeric", month: "long" })} - ${new Date(to - 1).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}`;
  await attempt("Rapor yüklenemedi.", async () => {
    const response = await api(`/api/reports?${rangeQuery()}`);
    if (!response.ok) return reportFailure(response, "Rapor yüklenemedi.");
    renderReport(await response.json());
  });
}

$("rangeTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  range = btn.dataset.range;
  document.querySelectorAll("#rangeTabs button").forEach((b) => b.classList.toggle("active", b === btn));
  loadReport();
});

// CSV: anahtar başlıkla gönderildiği için dosya fetch ile alınıp tarayıcıdan indirilir
$("csvBtn").addEventListener("click", async () => {
  await attempt("CSV indirilemedi.", async () => {
    const response = await api(`/api/reports/orders.csv?${rangeQuery()}`);
    if (!response.ok) return reportFailure(response, "CSV indirilemedi.");
    const blob = await response.blob();
    const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "");
    const link = el("a", { href: URL.createObjectURL(blob), download: match ? match[1] : "siparisler.csv" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showMessage("CSV dosyası indirildi. Excel'de açabilirsiniz.", "success");
  });
});

// ---------- Menü yönetimi ----------
async function loadMenu() {
  menu = await (await fetch("/api/menu")).json();
  renderItems();
  renderSizes();
  $("categoryList").innerHTML = "";
  [...new Set(menu.items.map((i) => i.category))].forEach((c) => $("categoryList").appendChild(el("option", { value: c })));
}

function renderItems() {
  const list = $("itemList");
  list.innerHTML = "";
  if (!menu.items.length) list.appendChild(el("p", { className: "empty", textContent: "Menüde ürün yok." }));

  menu.items.forEach((item) => {
    const name = el("input", { type: "text", value: item.name, maxLength: 40 });
    name.setAttribute("aria-label", "Ürün adı");
    const category = el("input", { type: "text", value: item.category, maxLength: 30 });
    category.setAttribute("aria-label", "Kategori");
    category.setAttribute("list", "categoryList");
    const price = el("input", { type: "number", value: item.price, min: 0, step: 1 });
    price.setAttribute("aria-label", "Fiyat");
    const available = el("input", { type: "checkbox", checked: item.available });

    list.appendChild(el("div", { className: `editor-row${item.available ? "" : " unavailable"}` },
      el("div", { className: "fields" }, name, category, price),
      el("div", { className: "row-actions" },
        el("label", { className: "inline-check" }, available, " Serviste (mevcut)"),
        button("Kaydet", "btn-primary", () =>
          updateItem(item.id, { name: name.value, category: category.value, price: price.valueAsNumber, available: available.checked })),
        button("Sil", "btn-danger", () => deleteItem(item)))));
  });
}

async function updateItem(id, data) {
  await attempt("Ürün güncellenemedi.", async () => {
    const response = await api(`/api/menu/items/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (!response.ok) return reportFailure(response, "Ürün güncellenemedi.");
    showMessage("Ürün kaydedildi.", "success");
    await loadMenu();
  });
}

async function deleteItem(item) {
  if (!confirm(`"${item.name}" menüden silinsin mi? (Eski siparişler etkilenmez.)`)) return;
  await attempt("Ürün silinemedi.", async () => {
    const response = await api(`/api/menu/items/${item.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) return reportFailure(response, "Ürün silinemedi.");
    await loadMenu();
  });
}

$("addItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = { name: form.name.value, category: form.category.value, price: form.price.valueAsNumber };
  await attempt("Ürün eklenemedi.", async () => {
    const response = await api("/api/menu/items", { method: "POST", body: JSON.stringify(data) });
    if (!response.ok) return reportFailure(response, "Ürün eklenemedi.");
    form.name.value = "";
    form.price.value = "";
    showMessage("Ürün eklendi.", "success");
    await loadMenu();
  });
});

function addSizeRow(size = { name: "", extra: 0 }) {
  const name = el("input", { type: "text", value: size.name, maxLength: 20, placeholder: "Boyut adı", required: true });
  name.setAttribute("aria-label", "Boyut adı");
  const extra = el("input", { type: "number", value: size.extra, min: 0, step: 1, required: true });
  extra.setAttribute("aria-label", "Ek ücret");
  const row = el("div", { className: "fields size" }, name, extra);
  row.appendChild(button("Kaldır", "btn-danger", () => row.remove()));
  $("sizeRows").appendChild(row);
}

function renderSizes() {
  $("sizeRows").innerHTML = "";
  menu.sizes.forEach(addSizeRow);
}

$("addSizeBtn").addEventListener("click", () => addSizeRow());

$("sizesForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sizes = [...$("sizeRows").children].map((row) => ({ name: row.children[0].value, extra: row.children[1].valueAsNumber }));
  await attempt("Boyutlar kaydedilemedi.", async () => {
    const response = await api("/api/menu/sizes", { method: "PUT", body: JSON.stringify({ sizes }) });
    if (!response.ok) return reportFailure(response, "Boyutlar kaydedilemedi.");
    showMessage("Boyutlar kaydedildi.", "success");
    await loadMenu();
  });
});

// ---------- Ayarlar (marka, masa sayısı) ----------
function updatePreview() {
  const form = $("settingsForm");
  const name = form.cafeName.value.trim() || "Kafe adı";
  $("previewName").textContent = name;
  $("previewTagline").textContent = form.tagline.value.trim();
  $("previewTagline").hidden = !form.tagline.value.trim();
  $("previewMark").textContent = name.charAt(0).toLocaleUpperCase("tr-TR");
}

function renderSettings() {
  const s = window.Brand.data || {};
  const form = $("settingsForm");
  form.cafeName.value = s.cafeName || "";
  form.tagline.value = s.tagline || "";
  form.tableCount.value = Number.isInteger(s.tableCount) ? s.tableCount : 10;

  const swatches = $("swatches");
  swatches.innerHTML = "";
  Object.keys(THEME_COLORS).forEach((theme) => {
    const radio = el("input", { type: "radio", name: "theme", value: theme, checked: (s.theme || "kahve") === theme });
    // Seçilince temayı hemen önizle (kaydedilene kadar kalıcı değil)
    radio.addEventListener("change", () => { document.documentElement.dataset.theme = theme; });
    const dot = el("i");
    dot.style.setProperty("--swatch", THEME_COLORS[theme]);
    swatches.appendChild(el("label", { className: "swatch" }, radio, dot, THEME_NAMES[theme]));
  });
  updatePreview();
}

$("settingsForm").addEventListener("input", updatePreview);

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const theme = (form.querySelector("input[name=theme]:checked") || {}).value;
  await attempt("Ayarlar kaydedilemedi.", async () => {
    const response = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ cafeName: form.cafeName.value, tagline: form.tagline.value, theme, tableCount: form.tableCount.valueAsNumber }),
    });
    if (!response.ok) return reportFailure(response, "Ayarlar kaydedilemedi.");
    const saved = await response.json();
    window.Brand.apply(saved);
    try { localStorage.setItem("brandCache", JSON.stringify(saved)); } catch { /* yoksay */ }
    showMessage("Ayarlar kaydedildi.", "success");
  });
});

// ---------- Sekmeler ----------
const TABS = {
  orders: ["tabOrders", "ordersView"],
  reports: ["tabReports", "reportsView"],
  menu: ["tabMenu", "menuView"],
  settings: ["tabSettings", "settingsView"],
};

function selectTab(name) {
  currentTab = name;
  Object.entries(TABS).forEach(([key, [tabId, viewId]]) => {
    const active = key === name;
    $(viewId).hidden = !active;
    $(tabId).classList.toggle("active", active);
    $(tabId).setAttribute("aria-selected", active);
  });
  // Kaydedilmemiş tema önizlemesi sekme değişince geri alınır
  if (window.Brand.data) document.documentElement.dataset.theme = window.Brand.data.theme || "kahve";
  if (name === "settings") renderSettings();
  if (name === "reports") loadReport();
  if (name === "orders" && view === "archive") loadOrders();
}
Object.entries(TABS).forEach(([key, [tabId]]) => $(tabId).addEventListener("click", () => selectTab(key)));
$("logoutBtn").addEventListener("click", () => logout());

// ---------- Başlangıç ----------
async function showPanel() {
  try {
    await loadMenu();
  } catch {
    return showMessage("Sunucuya ulaşılamadı.");
  }

  messageEl.hidden = true;
  loginView.hidden = true;
  panel.hidden = false;
  $("logoutBtn").hidden = false;
  selectTab("orders");
  await loadOrders();
  pollTimer = setInterval(loadOrders, POLL_MS);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("tokenInput");
  token = input.value.trim();
  input.value = "";
  try {
    const response = await fetch("/api/orders?limit=1", { headers: { "x-admin-token": token } });
    if (response.status === 401) { token = null; return showMessage("Yönetici anahtarı yanlış."); }
    if (response.status === 429) { token = null; return showMessage("Çok fazla hatalı deneme. Biraz bekleyin."); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    token = null;
    return showMessage("Sunucuya ulaşılamadı.");
  }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* yoksay */ }
  showPanel();
});

if (token) showPanel();
