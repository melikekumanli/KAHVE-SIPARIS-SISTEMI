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

const orderLabel = (o) => (o.number ? `#${o.number}` : "Sipariş");

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
  window.Brand.setPending(0);
  panel.hidden = true;
  $("logoutBtn").hidden = true;
  loginView.hidden = false;
  if (message) showMessage(message);
}

// ---------- Fiş ----------
function printReceipt(order) {
  const brand = window.Brand.data || {};
  const line = (left, right, cls = "") =>
    el("div", { className: `line ${cls}` }, el("span", { textContent: left }), el("span", { textContent: right }));
  const r = $("receipt");
  r.innerHTML = "";
  r.append(
    el("h1", { textContent: brand.cafeName || "" }),
    ...(brand.tagline ? [el("div", { className: "center", textContent: brand.tagline })] : []),
    el("hr"),
    el("div", { className: "center", textContent: "SİPARİŞ NO" }),
    el("div", { className: "big", textContent: order.number ? `#${order.number}` : "-" }),
    el("div", { className: "center", textContent: new Date(order.createdAt).toLocaleString("tr-TR") }),
    el("hr"),
    line("Müşteri", order.name),
    line(order.type, order.size),
    ...(order.note ? [el("div", { textContent: `Not: ${order.note}` })] : []),
    el("hr"),
    line("TOPLAM", `${order.price} TL`, "total"),
    el("hr"),
    el("div", { className: "center", textContent: "Afiyet olsun!" })
  );
  window.print();
}

// ---------- Siparişler: pano ----------
function button(text, className, onClick, title) {
  const b = el("button", { type: "button", className: `btn btn-sm ${className}`.trim(), textContent: text });
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function ticket(order) {
  const flow = FLOW[order.status];
  const actions = el("div", { className: "ticket-actions" });
  if (flow) {
    actions.appendChild(button(flow.label, "btn-primary", () => changeStatus(order.id, flow.next)));
    if (flow.prev) actions.appendChild(button("Geri al", "", () => changeStatus(order.id, flow.prev), `"${flow.prev}" durumuna döndür`));
  }
  actions.append(
    button("Fiş", "", () => printReceipt(order)),
    button("Sil", "btn-danger", () => removeOrder(order))
  );

  return el("li", { className: "ticket" },
    el("div", { className: "ticket-head" },
      el("span", { className: "ticket-no", textContent: orderLabel(order) }),
      el("span", { className: "ticket-time", textContent: formatDateTime(order.createdAt) })),
    el("div", { className: "ticket-item" }, order.type, " ", el("span", { textContent: `· ${order.size}` })),
    el("div", { className: "ticket-meta", textContent: `${order.name} · ${order.price} ₺` }),
    ...(order.note ? [el("div", { className: "ticket-note", textContent: `Not: ${order.note}` })] : []),
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
      el("td", { textContent: `${o.type} · ${o.size}` }),
      el("td", { className: "num", textContent: `${o.price} ₺` }),
      el("td", { textContent: formatDateTime(o.createdAt) }),
      el("td", {}, el("div", { className: "actions" },
        button("Geri al", "", () => changeStatus(o.id, "Hazır"), "Teslime hazır durumuna döndür"),
        button("Fiş", "", () => printReceipt(o)),
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

    if (view === "archive") {
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

// ---------- Ayarlar (marka) ----------
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
      body: JSON.stringify({ cafeName: form.cafeName.value, tagline: form.tagline.value, theme }),
    });
    if (!response.ok) return reportFailure(response, "Ayarlar kaydedilemedi.");
    const saved = await response.json();
    window.Brand.apply(saved);
    try { localStorage.setItem("brandCache", JSON.stringify(saved)); } catch { /* yoksay */ }
    showMessage("Ayarlar kaydedildi.", "success");
  });
});

// ---------- Sekmeler ----------
const TABS = { orders: ["tabOrders", "ordersView"], menu: ["tabMenu", "menuView"], settings: ["tabSettings", "settingsView"] };

function selectTab(name) {
  Object.entries(TABS).forEach(([key, [tabId, viewId]]) => {
    const active = key === name;
    $(viewId).hidden = !active;
    $(tabId).classList.toggle("active", active);
    $(tabId).setAttribute("aria-selected", active);
  });
  // Kaydedilmemiş tema önizlemesi sekme değişince geri alınır
  if (window.Brand.data) document.documentElement.dataset.theme = window.Brand.data.theme || "kahve";
  if (name === "settings") renderSettings();
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
