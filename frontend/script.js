const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const listEl = document.getElementById("orderList");
const emptyInfoEl = document.getElementById("emptyInfo");
const catTabsEl = document.getElementById("catTabs");
const menuListEl = document.getElementById("menuList");
const cartLinesEl = document.getElementById("cartLines");
const cartEmptyEl = document.getElementById("cartEmpty");
const cartCountEl = document.getElementById("cartCount");
const totalEl = document.getElementById("total");
const serviceField = document.getElementById("serviceField");
const tableWrap = document.getElementById("tableWrap");
const mobileBar = document.getElementById("mobileBar");
const dialog = document.getElementById("itemDialog");

const STORAGE_KEY = "myOrderIds";
const NAME_KEY = "customerName";
const CART_KEY = "cart";
const SERVICE_KEY = "service";
const MAX_SAVED_ORDERS = 20;
const MAX_QTY = 20;
const POLL_MS = 5000;

let menu = null;
let tableCount = 0;
let cart = [];             // [{ type, size, qty }]
let categoryFilter = "";   // "" = tümü
let submitting = false;
let pollTimer = null;

const formatPrice = (n) => `${n} ₺`;

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- localStorage (kapalıysa sessizce çalışmaya devam eder) ---
function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* depolama kapalı */ }
}

const getSavedIds = () => {
  const ids = readStorage(STORAGE_KEY, []);
  return Array.isArray(ids) ? ids : [];
};
const saveIds = (ids) => writeStorage(STORAGE_KEY, ids.slice(0, MAX_SAVED_ORDERS));

// --- Bildirimler ---
let messageTimer;
function showMessage(text, type) {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 6000);
}

let toastTimer;
function showToast(text) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

// --- Fiyat yardımcıları ---
const findItem = (name) => menu && menu.items.find((i) => i.name === name);
const findSize = (name) => menu && menu.sizes.find((s) => s.name === name);

function unitPrice(line) {
  const item = findItem(line.type);
  const size = findSize(line.size);
  return item && size ? item.price + size.extra : 0;
}

const cartTotal = () => cart.reduce((sum, l) => sum + unitPrice(l) * l.qty, 0);
const cartQty = () => cart.reduce((sum, l) => sum + l.qty, 0);

// --- Menü ---
function qtyInCart(itemName) {
  return cart.filter((l) => l.type === itemName).reduce((s, l) => s + l.qty, 0);
}

function renderTabs() {
  const categories = [...new Set(menu.items.map((i) => i.category))];
  catTabsEl.innerHTML = "";
  catTabsEl.hidden = categories.length < 2;

  [["", "Tümü", menu.items.length], ...categories.map((c) => [c, c, menu.items.filter((i) => i.category === c).length])]
    .forEach(([value, label, count]) => {
      const tab = makeEl("button", `cat-tab${value === categoryFilter ? " active" : ""}`);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", value === categoryFilter);
      tab.append(label, makeEl("small", "", String(count)));
      tab.addEventListener("click", () => {
        categoryFilter = value;
        renderTabs();
        renderMenu();
      });
      catTabsEl.appendChild(tab);
    });
}

function renderMenu() {
  menuListEl.innerHTML = "";
  const categories = [...new Set(menu.items.map((i) => i.category))]
    .filter((c) => !categoryFilter || c === categoryFilter);

  if (!categories.length) {
    menuListEl.appendChild(makeEl("p", "empty", "Menüde ürün bulunmuyor."));
    return;
  }

  categories.forEach((category) => {
    const items = menu.items.filter((i) => i.category === category);
    const section = makeEl("section", "menu-section");
    const heading = makeEl("h2", "menu-category", category);
    heading.appendChild(makeEl("span", "", `${items.length} ürün`));
    const grid = makeEl("div", "menu-items");

    items.forEach((item) => {
      const inCart = qtyInCart(item.name);
      const button = makeEl("button", `menu-item${item.available ? "" : " disabled"}${inCart ? " in-cart" : ""}`);
      button.type = "button";
      button.disabled = !item.available;
      button.setAttribute("aria-label", item.available
        ? `${item.name}, ${formatPrice(item.price)}${inCart ? `, sepette ${inCart} adet` : ""}`
        : `${item.name}, tükendi`);
      button.addEventListener("click", () => openDialog(item));

      const nameWrap = makeEl("span", "menu-item-name", item.name);
      if (inCart) nameWrap.appendChild(makeEl("span", "pill", `${inCart} sepette`));
      button.appendChild(nameWrap);
      button.appendChild(item.available
        ? makeEl("span", "menu-item-price", formatPrice(item.price))
        : makeEl("span", "tag-soldout", "Tükendi"));
      if (item.available) button.appendChild(makeEl("span", "add-mark", "+"));
      grid.appendChild(button);
    });

    section.append(heading, grid);
    menuListEl.appendChild(section);
  });
}

// --- Ürün seçim penceresi (boyut + adet) ---
let dlgItem = null;
let dlgQty = 1;

function dlgSize() {
  const checked = document.querySelector("#dlgSizes input:checked");
  return findSize(checked ? checked.value : "");
}

function updateDialogPrice() {
  const size = dlgSize();
  const total = dlgItem && size ? (dlgItem.price + size.extra) * dlgQty : 0;
  document.getElementById("dlgQty").textContent = dlgQty;
  document.getElementById("dlgAdd").textContent = `Sepete ekle · ${formatPrice(total)}`;
  document.getElementById("dlgMinus").disabled = dlgQty <= 1;
  document.getElementById("dlgPlus").disabled = dlgQty >= MAX_QTY;
}

function openDialog(item) {
  dlgItem = item;
  dlgQty = 1;
  document.getElementById("dlgTitle").textContent = item.name;
  document.getElementById("dlgMeta").textContent = `${item.category} · ${formatPrice(item.price)}`;

  const sizesEl = document.getElementById("dlgSizes");
  sizesEl.innerHTML = "";
  menu.sizes.forEach((size, i) => {
    const label = makeEl("label", "seg");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "dlgSize";
    input.value = size.name;
    input.className = "sr-only";
    input.checked = i === 0;
    input.addEventListener("change", updateDialogPrice);
    label.append(input, makeEl("span", "", size.name), makeEl("small", "", size.extra ? `+${formatPrice(size.extra)}` : "Standart"));
    sizesEl.appendChild(label);
  });

  updateDialogPrice();
  dialog.showModal();
}

document.getElementById("dlgMinus").addEventListener("click", () => { dlgQty = Math.max(1, dlgQty - 1); updateDialogPrice(); });
document.getElementById("dlgPlus").addEventListener("click", () => { dlgQty = Math.min(MAX_QTY, dlgQty + 1); updateDialogPrice(); });
document.getElementById("dlgClose").addEventListener("click", () => dialog.close());
// Pencerenin dışına (karartılmış alana) tıklayınca kapat
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

document.getElementById("dlgForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const size = dlgSize();
  if (!dlgItem || !size) return;
  addToCart(dlgItem.name, size.name, dlgQty);
  dialog.close();
  showToast(`${dlgQty} × ${dlgItem.name} sepete eklendi`);
});

// --- Sepet ---
function saveCart() { writeStorage(CART_KEY, cart); }

function addToCart(type, size, qty) {
  const existing = cart.find((l) => l.type === type && l.size === size);
  if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
  else cart.push({ type, size, qty });
  saveCart();
  renderCart();
  renderMenu();
}

function changeQty(index, delta) {
  const line = cart[index];
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) cart.splice(index, 1);
  line.qty = Math.min(MAX_QTY, line.qty);
  saveCart();
  renderCart();
  renderMenu();
}

// Menüde olmayan ya da tükenen ürünleri sepetten çıkarır; çıkarılanların adını döner
function pruneCart() {
  const removed = [];
  cart = cart.filter((l) => {
    const item = findItem(l.type);
    const ok = item && item.available && findSize(l.size);
    if (!ok) removed.push(l.type);
    return ok;
  });
  if (removed.length) saveCart();
  return [...new Set(removed)];
}

function renderCart() {
  cartLinesEl.innerHTML = "";
  const qty = cartQty();
  const total = cartTotal();

  cartEmptyEl.hidden = cart.length > 0;
  cartCountEl.hidden = qty === 0;
  cartCountEl.textContent = qty;

  cart.forEach((line, index) => {
    const li = makeEl("li", "cart-line");

    const info = makeEl("div", "cart-info");
    info.append(makeEl("div", "cart-name", line.type), makeEl("div", "cart-meta", `${line.size} · ${formatPrice(unitPrice(line))}`));

    const stepper = makeEl("div", "stepper small");
    const minus = makeEl("button", "", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", line.qty === 1 ? `${line.type} ürününü sepetten kaldır` : `${line.type} adedini azalt`);
    minus.addEventListener("click", () => changeQty(index, -1));
    const plus = makeEl("button", "", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", `${line.type} adedini artır`);
    plus.disabled = line.qty >= MAX_QTY;
    plus.addEventListener("click", () => changeQty(index, 1));
    const out = makeEl("output", "", String(line.qty));
    stepper.append(minus, out, plus);

    li.append(info, stepper, makeEl("div", "cart-price", formatPrice(unitPrice(line) * line.qty)));
    cartLinesEl.appendChild(li);
  });

  totalEl.textContent = formatPrice(total);
  document.getElementById("barTotal").textContent = formatPrice(total);
  document.getElementById("barLabel").textContent = qty ? `Sepet · ${qty} ürün` : "Sepet";
  mobileBar.classList.toggle("visible", qty > 0);
  document.body.classList.toggle("has-bar", qty > 0);

  updateSubmit();
}

function updateSubmit() {
  if (!menu || !menu.items.some((i) => i.available)) {
    submitBtn.disabled = true;
    submitBtn.textContent = menu ? "Şu an sipariş alınamıyor" : "Menü yükleniyor...";
  } else if (submitting) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Gönderiliyor...";
  } else if (!cart.length) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Önce sepete ürün ekleyin";
  } else {
    submitBtn.disabled = false;
    submitBtn.textContent = `Siparişi tamamla · ${formatPrice(cartTotal())}`;
  }
}

// --- Servis türü (masa / paket) ---
function currentService() {
  const checked = form.querySelector("input[name=service]:checked");
  return checked ? checked.value : "Masa";
}

function renderService() {
  serviceField.hidden = tableCount === 0;
  const select = form.elements.table;
  const saved = readStorage(SERVICE_KEY, {});
  select.innerHTML = "";
  select.appendChild(new Option("Masa numarası seçin", ""));
  for (let i = 1; i <= tableCount; i++) select.appendChild(new Option(`Masa ${i}`, String(i)));
  if (saved.table >= 1 && saved.table <= tableCount) select.value = String(saved.table);
  const radio = form.querySelector(`input[name=service][value="${saved.service === "Paket" ? "Paket" : "Masa"}"]`);
  if (radio) radio.checked = true;
  tableWrap.hidden = currentService() !== "Masa";
}

form.addEventListener("change", (e) => {
  if (e.target.name === "service" || e.target.name === "table") {
    tableWrap.hidden = currentService() !== "Masa";
    writeStorage(SERVICE_KEY, { service: currentService(), table: Number(form.elements.table.value) || null });
  }
});

// --- Menü ve ayarları yükle ---
async function loadMenu() {
  try {
    const [menuRes, settingsRes] = await Promise.all([fetch("/api/menu"), fetch("/api/settings")]);
    if (!menuRes.ok) throw new Error(`HTTP ${menuRes.status}`);
    menu = await menuRes.json();
    tableCount = settingsRes.ok ? Number((await settingsRes.json()).tableCount) || 0 : 0;

    if (categoryFilter && !menu.items.some((i) => i.category === categoryFilter)) categoryFilter = "";
    const removed = pruneCart();
    if (removed.length) showMessage(`${removed.join(", ")} artık mevcut olmadığı için sepetten çıkarıldı.`, "error");

    renderTabs();
    renderMenu();
    renderService();
    renderCart();
  } catch (error) {
    console.error("Menü yüklenemedi:", error);
    menuListEl.innerHTML = "";
    menuListEl.appendChild(makeEl("p", "empty", "Menü yüklenemedi. Sunucu çalışıyor mu?"));
    submitBtn.textContent = "Sunucuya ulaşılamadı";
    showMessage("Menü yüklenemedi. Sunucu çalışıyor mu?", "error");
  }
}

// --- Siparişlerim ---
const STATUS_CLASS = { "Bekliyor": "status-wait", "Hazırlanıyor": "status-prep", "Hazır": "status-ready", "Teslim Edildi": "status-done" };
const STEPS = ["Alındı", "Hazırlanıyor", "Hazır"];
const STEP_INDEX = { "Bekliyor": 0, "Hazırlanıyor": 1, "Hazır": 2, "Teslim Edildi": 3 };

function renderSteps(status) {
  const active = STEP_INDEX[status] ?? 0;
  const ol = makeEl("ol", "steps");
  STEPS.forEach((label, i) => {
    const li = makeEl("li", "", label);
    if (i < active) li.className = "done";
    else if (i === active) li.className = `current${status === "Hazır" ? " ready" : ""}`;
    ol.appendChild(li);
  });
  return ol;
}

const serviceLabel = (o) => (o.service === "Masa" ? `Masa ${o.table}` : o.service);

function renderOrders(orders) {
  listEl.innerHTML = "";
  emptyInfoEl.hidden = orders.length > 0;

  orders.forEach((order) => {
    const li = makeEl("li", "track");

    const head = makeEl("div", "track-head");
    head.append(
      makeEl("span", "track-no", order.number ? `#${order.number}` : "Sipariş"),
      makeEl("span", `badge ${STATUS_CLASS[order.status] || "status-wait"}`, order.status)
    );

    const items = makeEl("ul", "track-items");
    order.items.forEach((it) => items.appendChild(makeEl("li", "", `${it.qty} × ${it.name} · ${it.size}`)));

    const time = new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const meta = [order.name, formatPrice(order.price), time];
    if (order.service) meta.splice(1, 0, serviceLabel(order));

    li.append(head, items, makeEl("div", "track-meta", meta.join(" · ")));
    if (order.note) li.appendChild(makeEl("div", "track-note", `Not: ${order.note}`));
    if (order.status !== "Teslim Edildi") li.appendChild(renderSteps(order.status));
    listEl.appendChild(li);
  });
}

async function loadMyOrders() {
  const ids = getSavedIds();
  if (!ids.length) {
    renderOrders([]);
    stopPolling();
    return;
  }

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`);
      if (response.status === 404) return { id, gone: true };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
  );

  // Sunucuda artık olmayan (silinmiş) siparişleri hatırlamayı bırak
  const goneIds = results.filter((r) => r.status === "fulfilled" && r.value.gone).map((r) => r.value.id);
  if (goneIds.length) saveIds(ids.filter((id) => !goneIds.includes(id)));

  const orders = results.filter((r) => r.status === "fulfilled" && !r.value.gone).map((r) => r.value);
  renderOrders(orders);

  // Teslim edilmemiş sipariş varsa durumu düzenli kontrol et
  if (orders.some((o) => o.status !== "Teslim Edildi")) startPolling();
  else stopPolling();
}

function startPolling() {
  if (!pollTimer) pollTimer = setInterval(loadMyOrders, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// --- Sipariş gönderme ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submitting || !cart.length) return; // çift gönderimi engelle

  const name = form.elements.name.value.trim();
  if (!name) {
    showMessage("Lütfen adınızı yazın.", "error");
    form.elements.name.focus();
    return;
  }

  const service = tableCount > 0 ? currentService() : "";
  const table = Number(form.elements.table.value) || null;
  if (tableCount > 0 && service === "Masa" && !table) {
    showMessage("Lütfen masa numaranızı seçin ya da \"Paket\" seçeneğini işaretleyin.", "error");
    form.elements.table.focus();
    return;
  }

  const data = {
    name,
    note: form.elements.note.value,
    items: cart.map((l) => ({ type: l.type, size: l.size, qty: l.qty })),
    ...(tableCount > 0 ? { service, table: service === "Masa" ? table : undefined } : {}),
  };

  submitting = true;
  updateSubmit();

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      const { order } = await response.json();
      saveIds([order.id, ...getSavedIds()]);
      writeStorage(NAME_KEY, order.name);
      form.elements.note.value = "";
      cart = [];
      saveCart();
      showMessage(
        order.number ? `Siparişiniz alındı. Sipariş numaranız: #${order.number}` : "Siparişiniz alındı, teşekkürler!",
        "success"
      );
      await loadMenu(); // güncel menü (tükenen ürünler)
      await loadMyOrders();
      document.getElementById("orderList").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      // Sunucu doğrulama hatalarını { errors: [...] } olarak döner
      const body = await response.json().catch(() => ({}));
      showMessage((body.errors && body.errors.join(" ")) || "Sunucu hatası oluştu.", "error");
      if (response.status === 400) await loadMenu(); // ürün tükenmiş ya da masa sayısı değişmiş olabilir
    }
  } catch (error) {
    console.error("İstek hatası:", error);
    showMessage("Bağlantı kurulamadı.", "error");
  } finally {
    submitting = false;
    updateSubmit();
  }
});

// --- Başlangıç ---
const savedCart = readStorage(CART_KEY, []);
cart = Array.isArray(savedCart)
  ? savedCart.filter((l) => l && typeof l.type === "string" && typeof l.size === "string" && Number.isInteger(l.qty) && l.qty > 0)
  : [];
form.elements.name.value = readStorage(NAME_KEY, "");
loadMenu();
loadMyOrders();
