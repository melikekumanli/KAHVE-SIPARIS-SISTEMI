const $ = (id) => document.getElementById(id);

const loginView = $("loginView");
const panel = $("panel");
const listEl = $("adminList");
const messageEl = $("message");
const soundToggle = $("soundToggle");
const statusFilter = $("statusFilter");

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
const STATUS_CLASS = { "Bekliyor": "status-wait", "Hazırlanıyor": "status-prep", "Hazır": "status-ready", [DONE]: "status-done" };
const THEME_COLORS = { kahve: "#8b5a3c", zeytin: "#5d6c3a", lacivert: "#2f4f86", bordo: "#8c2f45" };
const THEME_NAMES = { kahve: "Kahve", zeytin: "Zeytin", lacivert: "Lacivert", bordo: "Bordo" };

let token = null;
let menu = { items: [], sizes: [], statuses: [] };
let orders = [];          // görünümdeki siparişler (aktif ya da arşiv)
let activeOrders = [];    // aktif siparişlerin tümü (sayaçlar için)
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
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? formatTime(iso)
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
  const r = $("receipt");
  const line = (left, right, cls = "") =>
    el("div", { className: `line ${cls}` }, el("span", { textContent: left }), el("span", { textContent: right }));
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

// ---------- Siparişler ----------
function renderStats() {
  const count = (status) => activeOrders.filter((o) => o.status === status).length;
  $("statWait").textContent = count("Bekliyor");
  $("statPrep").textContent = count("Hazırlanıyor");
  $("statReady").textContent = count("Hazır");

  const pending = count("Bekliyor");
  $("pendingCount").textContent = pending;
  $("pendingCount").hidden = pending === 0;
  window.Brand.setPending(pending);
}

function orderCard(order) {
  const flow = FLOW[order.status];
  const actions = el("div", { className: "order-actions" });

  if (view === "active" && flow) {
    const next = el("button", { type: "button", className: "btn btn-primary btn-sm", textContent: flow.label });
    next.addEventListener("click", () => changeStatus(order.id, flow.next));
    actions.appendChild(next);
    if (flow.prev) {
      const back = el("button", { type: "button", className: "btn btn-sm", textContent: "Geri al", title: `"${flow.prev}" durumuna döndür` });
      back.addEventListener("click", () => changeStatus(order.id, flow.prev));
      actions.appendChild(back);
    }
  }
  if (view === "archive") {
    const reopen = el("button", { type: "button", className: "btn btn-sm", textContent: "Geri al", title: "Teslime hazır durumuna döndür" });
    reopen.addEventListener("click", () => changeStatus(order.id, "Hazır"));
    actions.appendChild(reopen);
  }
  const print = el("button", { type: "button", className: "btn btn-sm", textContent: "Fiş" });
  print.addEventListener("click", () => printReceipt(order));
  const del = el("button", { type: "button", className: "btn btn-sm btn-danger", textContent: "Sil" });
  del.addEventListener("click", () => removeOrder(order));
  actions.append(print, del);

  return el("li", { className: "order-card" },
    el("div", { className: "order-head" },
      el("span", { className: "order-no", textContent: orderLabel(order) }),
      el("span", { className: `badge ${STATUS_CLASS[order.status] || "status-wait"}`, textContent: order.status })),
    el("div", { className: "order-title", textContent: `${order.type} · ${order.size}` }),
    el("div", { className: "order-meta", textContent: `${order.name} · ${order.price} ₺ · ${formatDateTime(order.createdAt)}` }),
    ...(order.note ? [el("div", { className: "order-note", textContent: `Not: ${order.note}` })] : []),
    actions);
}

function renderOrders() {
  const filter = view === "active" ? statusFilter.value : "";
  const shown = filter ? orders.filter((o) => o.status === filter) : orders;

  listEl.innerHTML = "";
  if (view === "archive") {
    $("summary").textContent = shown.length
      ? `Son ${shown.length} teslim edilen sipariş (en fazla ${ARCHIVE_LIMIT} gösterilir)`
      : "Arşivde sipariş yok.";
  } else {
    $("summary").textContent = shown.length ? `${shown.length} aktif sipariş` : "Aktif sipariş yok.";
  }
  shown.forEach((order) => listEl.appendChild(orderCard(order)));
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

    orders = view === "active" ? active : await fetchOrders(`?status=${encodeURIComponent(DONE)}&limit=${ARCHIVE_LIMIT}`);
    renderStats();
    renderOrders();
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
  statusFilter.hidden = next === "archive";
  loadOrders();
}
$("viewActive").addEventListener("click", () => setView("active"));
$("viewArchive").addEventListener("click", () => setView("archive"));
statusFilter.addEventListener("change", renderOrders);

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

    const save = el("button", { type: "button", className: "btn btn-primary btn-sm", textContent: "Kaydet" });
    save.addEventListener("click", () =>
      updateItem(item.id, { name: name.value, category: category.value, price: price.valueAsNumber, available: available.checked }));
    const del = el("button", { type: "button", className: "btn btn-sm btn-danger", textContent: "Sil" });
    del.addEventListener("click", () => deleteItem(item));

    list.appendChild(el("div", { className: `editor-row${item.available ? "" : " unavailable"}` },
      el("div", { className: "fields" }, name, category, price),
      el("div", { className: "row-actions" },
        el("label", { className: "inline-check" }, available, " Mevcut"), save, del)));
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
  const remove = el("button", { type: "button", className: "btn btn-sm btn-danger", textContent: "Kaldır" });
  const row = el("div", { className: "fields size" }, name, extra, remove);
  remove.addEventListener("click", () => row.remove());
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
}

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

  statusFilter.innerHTML = "";
  [["", "Tüm aktifler"], ...menu.statuses.filter((s) => s !== DONE).map((s) => [s, s])]
    .forEach(([value, label]) => statusFilter.appendChild(el("option", { value, textContent: label })));

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
