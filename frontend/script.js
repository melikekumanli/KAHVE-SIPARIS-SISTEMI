const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const listEl = document.getElementById("orderList");
const emptyInfoEl = document.getElementById("emptyInfo");
const typeOptionsEl = document.getElementById("typeOptions");
const sizeOptionsEl = document.getElementById("sizeOptions");
const totalEl = document.getElementById("total");

const STORAGE_KEY = "myOrderIds";
const MAX_SAVED_ORDERS = 20;
const POLL_MS = 5000;

let menu = null;
let pollTimer = null;

const NAME_KEY = "customerName";

const formatPrice = (n) => `${n} ₺`;

// --- localStorage (kapalıysa sessizce çalışmaya devam eder) ---
function getSavedIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function saveIds(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_SAVED_ORDERS)));
  } catch {
    /* depolama kapalı: sadece sayfa açıkken görünür */
  }
}

function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}

function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* depolama kapalı */ }
}

// --- Bildirim ---
let messageTimer;
function showMessage(text, type) {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 5000);
}

// --- Menü ve form ---
function addChoice(container, group, value, label, price, { checked = false, disabled = false } = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "choice" + (disabled ? " disabled" : "");

  const input = document.createElement("input");
  input.type = "radio";
  input.name = group;
  input.value = value;
  input.required = true;
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", updateTotal);

  const text = document.createElement("span");
  text.textContent = label;

  const priceEl = document.createElement("small");
  priceEl.textContent = price;

  wrapper.append(input, text, priceEl);
  container.appendChild(wrapper);
}

function renderMenu() {
  typeOptionsEl.innerHTML = "";
  sizeOptionsEl.innerHTML = "";

  // Ürünleri kategoriye göre grupla (kategoriler menüdeki ilk görülme sırasıyla)
  const categories = [...new Set(menu.items.map((i) => i.category))];
  let firstAvailableChecked = false;
  categories.forEach((category) => {
    const title = document.createElement("h3");
    title.className = "category-title";
    title.textContent = category;
    const group = document.createElement("div");
    group.className = "choices";

    menu.items.filter((i) => i.category === category).forEach((item) => {
      const checked = item.available && !firstAvailableChecked;
      if (checked) firstAvailableChecked = true;
      addChoice(group, "type", item.name, item.name,
        item.available ? formatPrice(item.price) : "Tükendi",
        { checked, disabled: !item.available });
    });
    typeOptionsEl.append(title, group);
  });

  menu.sizes.forEach((size, i) =>
    addChoice(sizeOptionsEl, "size", size.name, size.name,
      size.extra ? `+${formatPrice(size.extra)}` : "", { checked: i === 0 }));
  updateTotal();
}

function updateTotal() {
  if (!menu) return;
  const item = menu.items.find((i) => i.name === form.elements.type.value);
  const size = menu.sizes.find((s) => s.name === form.elements.size.value);
  totalEl.textContent = item && size ? formatPrice(item.price + size.extra) : "-";
}

async function loadMenu() {
  try {
    const response = await fetch(`/api/menu`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    menu = await response.json();
    renderMenu();
    if (menu.items.some((i) => i.available)) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sipariş Ver";
    } else {
      submitBtn.textContent = "Şu an sipariş alınamıyor";
    }
  } catch (error) {
    console.error("Menü yüklenemedi:", error);
    submitBtn.textContent = "Sunucuya ulaşılamadı";
    showMessage("Menü yüklenemedi. Sunucu çalışıyor mu?", "error");
  }
}

// --- Siparişlerim ---
function statusClass(status) {
  return "status-" + ({ "Bekliyor": "wait", "Hazırlanıyor": "prep", "Hazır": "ready", "Teslim Edildi": "done" }[status] || "wait");
}

function renderOrders(orders) {
  listEl.innerHTML = "";
  emptyInfoEl.hidden = orders.length > 0;

  orders.forEach((order) => {
    const li = document.createElement("li");

    const top = document.createElement("div");
    top.className = "order-top";
    const title = document.createElement("strong");
    title.textContent = `${order.type} (${order.size})`;
    const badge = document.createElement("span");
    badge.className = `badge ${statusClass(order.status)}`;
    badge.textContent = order.status;
    top.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "order-meta";
    const time = new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    meta.textContent =
      `${order.name} · ${formatPrice(order.price)} · ${time}` +
      (order.note ? ` · Not: ${order.note}` : "");

    li.append(top, meta);
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
  const goneIds = results
    .filter((r) => r.status === "fulfilled" && r.value.gone)
    .map((r) => r.value.id);
  if (goneIds.length) saveIds(ids.filter((id) => !goneIds.includes(id)));

  const orders = results
    .filter((r) => r.status === "fulfilled" && !r.value.gone)
    .map((r) => r.value);
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
  if (submitBtn.disabled) return; // çift gönderimi engelle

  const data = Object.fromEntries(new FormData(form).entries());

  submitBtn.disabled = true;
  submitBtn.textContent = "Gönderiliyor...";

  try {
    const response = await fetch(`/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      const { order } = await response.json();
      saveIds([order.id, ...getSavedIds()]);
      saveName(order.name);
      form.reset();
      form.elements.name.value = getSavedName();
      await loadMenu(); // güncel menü (tükenen ürünler) ve varsayılan seçimler
      showMessage("Siparişin alındı, teşekkürler!", "success");
      await loadMyOrders();
    } else {
      // Sunucu doğrulama hatalarını { errors: [...] } olarak döner
      const body = await response.json().catch(() => ({}));
      showMessage(
        (body.errors && body.errors.join(" ")) || "Sunucu hatası oluştu.",
        "error"
      );
    }
  } catch (error) {
    console.error("İstek hatası:", error);
    showMessage("Bağlantı kurulamadı.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sipariş Ver";
  }
});

form.elements.name.value = getSavedName();
loadMenu();
loadMyOrders();
