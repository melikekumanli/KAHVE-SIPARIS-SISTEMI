const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const listEl = document.getElementById("orderList");
const emptyInfoEl = document.getElementById("emptyInfo");
const catTabsEl = document.getElementById("catTabs");
const menuListEl = document.getElementById("menuList");
const sizeOptionsEl = document.getElementById("sizeOptions");
const selectionEl = document.getElementById("selection");
const totalEl = document.getElementById("total");
const mobileBar = document.getElementById("mobileBar");

const STORAGE_KEY = "myOrderIds";
const NAME_KEY = "customerName";
const MAX_SAVED_ORDERS = 20;
const POLL_MS = 5000;

let menu = null;
let selectedType = "";     // seçili ürünün adı
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

// --- Bildirim ---
let messageTimer;
function showMessage(text, type) {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 6000);
}

// --- Menü ---
function currentSize() {
  return menu && menu.sizes.find((s) => s.name === form.elements.size.value);
}

function currentItem() {
  return menu && menu.items.find((i) => i.name === selectedType && i.available);
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
      const label = makeEl("label", `menu-item${item.available ? "" : " disabled"}`);

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "type";
      input.value = item.name;
      input.className = "sr-only";
      input.checked = item.available && item.name === selectedType;
      input.disabled = !item.available;
      input.addEventListener("change", () => {
        selectedType = item.name;
        updateSelection();
      });

      label.append(input, makeEl("span", "radio-dot"), makeEl("span", "menu-item-name", item.name));
      label.appendChild(item.available
        ? makeEl("span", "menu-item-price", formatPrice(item.price))
        : makeEl("span", "tag-soldout", "Tükendi"));
      grid.appendChild(label);
    });

    section.append(heading, grid);
    menuListEl.appendChild(section);
  });
}

function renderSizes() {
  sizeOptionsEl.innerHTML = "";
  menu.sizes.forEach((size, i) => {
    const label = makeEl("label", "seg");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "size";
    input.value = size.name;
    input.className = "sr-only";
    input.checked = i === 0;
    input.addEventListener("change", updateSelection);
    label.append(input, makeEl("span", "", size.name), makeEl("small", "", size.extra ? `+${formatPrice(size.extra)}` : "Standart"));
    sizeOptionsEl.appendChild(label);
  });
}

function updateSelection() {
  if (!menu) return;
  const item = currentItem();
  if (!item) selectedType = "";
  const size = currentSize();

  selectionEl.innerHTML = "";
  selectionEl.classList.toggle("filled", !!item);

  if (!item) {
    selectionEl.appendChild(makeEl("div", "selection-empty", "Menüden bir ürün seçin."));
    totalEl.textContent = "-";
    document.getElementById("barTotal").textContent = "-";
    mobileBar.classList.remove("visible");
    document.body.classList.remove("has-bar");
  } else {
    const total = item.price + (size ? size.extra : 0);
    selectionEl.append(
      makeEl("div", "selection-name", item.name),
      makeEl("div", "selection-meta", `${item.category}${size ? ` · ${size.name}` : ""}`)
    );
    totalEl.textContent = formatPrice(total);
    document.getElementById("barLabel").textContent = `${item.name}${size ? ` · ${size.name}` : ""}`;
    document.getElementById("barTotal").textContent = formatPrice(total);
    mobileBar.classList.add("visible");
    document.body.classList.add("has-bar");
  }

  if (!menu.items.some((i) => i.available)) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Şu an sipariş alınamıyor";
  } else if (submitting) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Gönderiliyor...";
  } else if (!item) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Önce bir ürün seçin";
  } else {
    submitBtn.disabled = false;
    submitBtn.textContent = `Siparişi tamamla · ${totalEl.textContent}`;
  }
}

async function loadMenu() {
  try {
    const response = await fetch("/api/menu");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    menu = await response.json();
    // Tükenen ya da silinen ürün seçiliyse seçimi temizle
    if (!menu.items.some((i) => i.name === selectedType && i.available)) selectedType = "";
    if (categoryFilter && !menu.items.some((i) => i.category === categoryFilter)) categoryFilter = "";
    renderTabs();
    renderMenu();
    renderSizes();
    updateSelection();
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

    const time = new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    li.append(
      head,
      makeEl("div", "track-title", `${order.type} · ${order.size}`),
      makeEl("div", "track-meta", `${order.name} · ${formatPrice(order.price)} · ${time}`)
    );
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
  if (submitting || !currentItem()) return; // çift gönderimi engelle

  const name = form.elements.name.value.trim();
  if (!name) {
    showMessage("Lütfen adınızı yazın.", "error");
    form.elements.name.focus();
    return;
  }

  const data = { name, type: selectedType, size: form.elements.size.value, note: form.elements.note.value };

  submitting = true;
  updateSelection();

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
      selectedType = "";
      showMessage(
        order.number ? `Siparişiniz alındı. Sipariş numaranız: #${order.number}` : "Siparişiniz alındı, teşekkürler!",
        "success"
      );
      await loadMenu(); // güncel menü (tükenen ürünler) ve temiz seçim
      await loadMyOrders();
    } else {
      // Sunucu doğrulama hatalarını { errors: [...] } olarak döner
      const body = await response.json().catch(() => ({}));
      showMessage((body.errors && body.errors.join(" ")) || "Sunucu hatası oluştu.", "error");
      if (response.status === 400) await loadMenu(); // ürün tükenmiş olabilir
    }
  } catch (error) {
    console.error("İstek hatası:", error);
    showMessage("Bağlantı kurulamadı.", "error");
  } finally {
    submitting = false;
    updateSelection();
  }
});

form.elements.name.value = readStorage(NAME_KEY, "");
loadMenu();
loadMyOrders();
