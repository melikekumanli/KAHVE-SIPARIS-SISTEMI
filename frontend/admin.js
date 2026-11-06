const $ = (id) => document.getElementById(id);

const loginForm = $("loginForm");
const tokenInput = $("tokenInput");
const panel = $("panel");
const statusFilter = $("statusFilter");
const summaryEl = $("summary");
const listEl = $("adminList");
const messageEl = $("message");
const pendingCountEl = $("pendingCount");
const soundToggle = $("soundToggle");

const TOKEN_KEY = "adminToken";
const POLL_MS = 4000;
const BASE_TITLE = "Barista Paneli";

let token = null;
let menu = { items: [], sizes: [], statuses: [] };
let allOrders = [];
let seenOrderIds = null; // null: ilk yükleme (ses çalma)
let pollTimer = null;
let audioCtx = null;

// Anahtar sadece bu sekme açıkken saklanır (sessionStorage), kalıcı değil.
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* depolama kapalı */ }

// ---------- Yardımcılar ----------
let messageTimer;
function showMessage(text, type = "error") {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 5000);
}

function statusClass(status) {
  return "status-" + ({ "Bekliyor": "wait", "Hazırlanıyor": "prep", "Hazır": "ready", "Teslim Edildi": "done" }[status] || "wait");
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

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

// İstek hatasını kullanıcıya gösterir (sunucunun doğrulama mesajları dahil)
async function reportFailure(response, fallback) {
  const body = await response.json().catch(() => ({}));
  showMessage((body.errors && body.errors.join(" ")) || fallback);
}

const isHandled = (error) => ["unauthorized", "rate-limited"].includes(error.message);

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

// ---------- Oturum ----------
function logout(message) {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* yoksay */ }
  clearInterval(pollTimer);
  pollTimer = null;
  seenOrderIds = null;
  document.title = BASE_TITLE;
  panel.hidden = true;
  loginForm.hidden = false;
  if (message) showMessage(message);
}

// ---------- Siparişler ----------
function renderOrders() {
  const filter = statusFilter.value;
  const orders = filter ? allOrders.filter((o) => o.status === filter) : allOrders;

  listEl.innerHTML = "";
  summaryEl.textContent = orders.length ? `${orders.length} sipariş` : "Bu filtrede sipariş yok.";

  orders.forEach((order) => {
    const select = el("select", { ariaLabel: "Sipariş durumu" });
    menu.statuses.forEach((s) => select.appendChild(el("option", { value: s, textContent: s, selected: s === order.status })));
    select.addEventListener("change", () => changeStatus(order.id, select.value));

    const del = el("button", { type: "button", className: "danger", textContent: "Sil" });
    del.addEventListener("click", () => removeOrder(order));

    listEl.appendChild(el("li", {},
      el("div", { className: "order-top" },
        el("strong", { textContent: `${order.name} - ${order.type} (${order.size})` }),
        el("span", { className: `badge ${statusClass(order.status)}`, textContent: order.status })),
      el("div", {
        className: "order-meta",
        textContent: `${order.price} ₺ · ${formatTime(order.createdAt)}` + (order.note ? ` · Not: ${order.note}` : ""),
      }),
      el("div", { className: "order-actions" }, select, del)));
  });

  const pending = allOrders.filter((o) => o.status === "Bekliyor").length;
  pendingCountEl.textContent = pending;
  pendingCountEl.hidden = pending === 0;
  document.title = pending ? `(${pending}) ${BASE_TITLE}` : BASE_TITLE;
}

async function loadOrders() {
  try {
    const response = await api("/api/orders");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    allOrders = await response.json();

    // İlk yüklemeden sonra gelen yeni siparişlerde ses çal
    const ids = new Set(allOrders.map((o) => o.id));
    if (seenOrderIds && allOrders.some((o) => !seenOrderIds.has(o.id))) beep();
    seenOrderIds = ids;

    renderOrders();
  } catch (error) {
    if (!isHandled(error)) showMessage("Siparişler yüklenemedi.");
  }
}

async function changeStatus(id, status) {
  try {
    const response = await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!response.ok) await reportFailure(response, "Durum güncellenemedi.");
  } catch (error) {
    if (!isHandled(error)) showMessage("Durum güncellenemedi.");
  }
  await loadOrders();
}

async function removeOrder(order) {
  if (!confirm(`${order.name} - ${order.type} siparişi silinsin mi?`)) return;
  try {
    const response = await api(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) await reportFailure(response, "Sipariş silinemedi.");
  } catch (error) {
    if (!isHandled(error)) showMessage("Sipariş silinemedi.");
  }
  await loadOrders();
}

// ---------- Menü yönetimi ----------
async function loadMenu() {
  menu = await (await fetch("/api/menu")).json();
  renderItems();
  renderSizes();
  $("categoryList").innerHTML = "";
  [...new Set(menu.items.map((i) => i.category))].forEach((c) =>
    $("categoryList").appendChild(el("option", { value: c })));
}

function renderItems() {
  const list = $("itemList");
  list.innerHTML = "";
  if (!menu.items.length) list.appendChild(el("li", { className: "empty-info", textContent: "Menüde ürün yok." }));

  menu.items.forEach((item) => {
    const name = el("input", { type: "text", value: item.name, maxLength: 40, ariaLabel: "Ürün adı" });
    const category = el("input", { type: "text", value: item.category, maxLength: 30, ariaLabel: "Kategori" });
    category.setAttribute("list", "categoryList");
    const price = el("input", { type: "number", value: item.price, min: 0, step: 1, ariaLabel: "Fiyat" });
    const available = el("input", { type: "checkbox", checked: item.available });
    const availLabel = el("label", { className: "inline-check" }, available, " Mevcut");

    const save = el("button", { type: "button", className: "small", textContent: "Kaydet" });
    save.addEventListener("click", () =>
      updateItem(item.id, { name: name.value, category: category.value, price: price.valueAsNumber, available: available.checked }));
    const del = el("button", { type: "button", className: "danger small", textContent: "Sil" });
    del.addEventListener("click", () => deleteItem(item));

    list.appendChild(el("li", { className: item.available ? "" : "unavailable" },
      el("div", { className: "item-form" }, name, category, price),
      el("div", { className: "item-actions" }, availLabel, save, del)));
  });
}

async function updateItem(id, data) {
  try {
    const response = await api(`/api/menu/items/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (!response.ok) return await reportFailure(response, "Ürün güncellenemedi.");
    showMessage("Ürün kaydedildi.", "success");
    await loadMenu();
  } catch (error) {
    if (!isHandled(error)) showMessage("Ürün güncellenemedi.");
  }
}

async function deleteItem(item) {
  if (!confirm(`"${item.name}" menüden silinsin mi? (Eski siparişler etkilenmez.)`)) return;
  try {
    const response = await api(`/api/menu/items/${item.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) return await reportFailure(response, "Ürün silinemedi.");
    await loadMenu();
  } catch (error) {
    if (!isHandled(error)) showMessage("Ürün silinemedi.");
  }
}

$("addItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = { name: form.name.value, category: form.category.value, price: form.price.valueAsNumber };
  try {
    const response = await api("/api/menu/items", { method: "POST", body: JSON.stringify(data) });
    if (!response.ok) return await reportFailure(response, "Ürün eklenemedi.");
    form.name.value = "";
    form.price.value = "";
    showMessage("Ürün eklendi.", "success");
    await loadMenu();
  } catch (error) {
    if (!isHandled(error)) showMessage("Ürün eklenemedi.");
  }
});

function addSizeRow(size = { name: "", extra: 0 }) {
  const name = el("input", { type: "text", value: size.name, maxLength: 20, placeholder: "Boyut adı", required: true, ariaLabel: "Boyut adı" });
  const extra = el("input", { type: "number", value: size.extra, min: 0, step: 1, required: true, ariaLabel: "Ek ücret" });
  const remove = el("button", { type: "button", className: "danger small", textContent: "Kaldır" });
  const row = el("div", { className: "item-form size-row" }, name, extra, remove);
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
  const sizes = [...$("sizeRows").children].map((row) => ({
    name: row.children[0].value,
    extra: row.children[1].valueAsNumber,
  }));
  try {
    const response = await api("/api/menu/sizes", { method: "PUT", body: JSON.stringify({ sizes }) });
    if (!response.ok) return await reportFailure(response, "Boyutlar kaydedilemedi.");
    showMessage("Boyutlar kaydedildi.", "success");
    await loadMenu();
  } catch (error) {
    if (!isHandled(error)) showMessage("Boyutlar kaydedilemedi.");
  }
});

// ---------- Sekmeler ----------
function selectTab(name) {
  const isOrders = name === "orders";
  $("ordersView").hidden = !isOrders;
  $("menuView").hidden = isOrders;
  $("tabOrders").classList.toggle("active", isOrders);
  $("tabMenu").classList.toggle("active", !isOrders);
  $("tabOrders").setAttribute("aria-selected", isOrders);
  $("tabMenu").setAttribute("aria-selected", !isOrders);
}
$("tabOrders").addEventListener("click", () => selectTab("orders"));
$("tabMenu").addEventListener("click", () => selectTab("menu"));
$("logoutBtn").addEventListener("click", () => logout());

// ---------- Başlangıç ----------
async function showPanel() {
  try {
    await loadMenu();
  } catch {
    return showMessage("Sunucuya ulaşılamadı.");
  }

  statusFilter.innerHTML = "";
  ["", ...menu.statuses].forEach((s) => statusFilter.appendChild(el("option", { value: s, textContent: s || "Tümü" })));

  messageEl.hidden = true;
  loginForm.hidden = true;
  panel.hidden = false;
  selectTab("orders");
  await loadOrders();
  pollTimer = setInterval(loadOrders, POLL_MS);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  token = tokenInput.value.trim();
  tokenInput.value = "";
  try {
    const response = await fetch("/api/orders", { headers: { "x-admin-token": token } });
    if (response.status === 401) { token = null; return showMessage("Yönetici anahtarı yanlış."); }
    if (response.status === 429) { token = null; return showMessage("Çok fazla hatalı deneme. Biraz bekleyin."); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    token = null;
    return showMessage("Sunucuya ulaşılamadı.");
  }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* yoksay */ }
  try { audioCtx = audioCtx || new AudioContext(); } catch { /* ses yok */ } // giriş tıklaması sesi etkinleştirir
  showPanel();
});

statusFilter.addEventListener("change", renderOrders);

// Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra açar (sayfa yenilense bile)
document.addEventListener("click", () => {
  try { audioCtx = audioCtx || new AudioContext(); audioCtx.resume(); } catch { /* ses yok */ }
});

if (token) showPanel();
