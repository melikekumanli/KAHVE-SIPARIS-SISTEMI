const loginForm = document.getElementById("loginForm");
const tokenInput = document.getElementById("tokenInput");
const panel = document.getElementById("panel");
const statusFilter = document.getElementById("statusFilter");
const logoutBtn = document.getElementById("logoutBtn");
const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("adminList");
const messageEl = document.getElementById("message");

const TOKEN_KEY = "adminToken";
const POLL_MS = 5000;

let token = null;
let statuses = [];
let pollTimer = null;

// Anahtar sadece bu sekme açıkken saklanır (sessionStorage), kalıcı değil.
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* depolama kapalı */ }

let messageTimer;
function showMessage(text, type) {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 5000);
}

function statusClass(status) {
  return "status-" + ({ "Bekliyor": "wait", "Hazırlanıyor": "prep", "Hazır": "ready", "Teslim Edildi": "done" }[status] || "wait");
}

async function api(path, options = {}) {
  const response = await fetch(`${window.API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "x-admin-token": token, ...options.headers },
  });
  if (response.status === 401) {
    logout("Yönetici anahtarı geçersiz.");
    throw new Error("unauthorized");
  }
  return response;
}

function logout(message) {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* yoksay */ }
  clearInterval(pollTimer);
  pollTimer = null;
  panel.hidden = true;
  loginForm.hidden = false;
  if (message) showMessage(message, "error");
}

function renderOrders(orders) {
  listEl.innerHTML = "";
  summaryEl.textContent = orders.length ? `${orders.length} sipariş` : "Bu filtrede sipariş yok.";

  orders.forEach((order) => {
    const li = document.createElement("li");

    const top = document.createElement("div");
    top.className = "order-top";
    const title = document.createElement("strong");
    title.textContent = `${order.name} - ${order.type} (${order.size})`;
    const badge = document.createElement("span");
    badge.className = `badge ${statusClass(order.status)}`;
    badge.textContent = order.status;
    top.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "order-meta";
    const time = new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    meta.textContent = `${order.price} ₺ · ${time}` + (order.note ? ` · Not: ${order.note}` : "");

    const actions = document.createElement("div");
    actions.className = "order-actions";

    const select = document.createElement("select");
    select.setAttribute("aria-label", "Sipariş durumu");
    statuses.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      opt.selected = s === order.status;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => changeStatus(order.id, select.value));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Sil";
    del.addEventListener("click", () => removeOrder(order));

    actions.append(select, del);
    li.append(top, meta, actions);
    listEl.appendChild(li);
  });
}

async function loadOrders() {
  try {
    const query = statusFilter.value ? `?status=${encodeURIComponent(statusFilter.value)}` : "";
    const response = await api(`/api/orders${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderOrders(await response.json());
  } catch (error) {
    if (error.message !== "unauthorized") showMessage("Siparişler yüklenemedi.", "error");
  }
}

async function changeStatus(id, status) {
  try {
    const response = await api(`/api/orders/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (error.message !== "unauthorized") showMessage("Durum güncellenemedi.", "error");
  }
  await loadOrders();
}

async function removeOrder(order) {
  if (!confirm(`${order.name} - ${order.type} siparişi silinsin mi?`)) return;
  try {
    const response = await api(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (error.message !== "unauthorized") showMessage("Sipariş silinemedi.", "error");
  }
  await loadOrders();
}

async function showPanel() {
  try {
    const menu = await (await fetch(`${window.API_URL}/api/menu`)).json();
    statuses = menu.statuses;
  } catch {
    showMessage("Sunucuya ulaşılamadı.", "error");
    return;
  }

  statusFilter.innerHTML = "";
  ["", ...statuses].forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s || "Tümü";
    statusFilter.appendChild(opt);
  });

  messageEl.hidden = true;
  loginForm.hidden = true;
  panel.hidden = false;
  await loadOrders();
  pollTimer = setInterval(loadOrders, POLL_MS);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  token = tokenInput.value;
  tokenInput.value = "";
  try {
    const response = await fetch(`${window.API_URL}/api/orders`, { headers: { "x-admin-token": token } });
    if (response.status === 401) {
      token = null;
      return showMessage("Yönetici anahtarı yanlış.", "error");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    token = null;
    return showMessage("Sunucuya ulaşılamadı.", "error");
  }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* yoksay */ }
  showPanel();
});

statusFilter.addEventListener("change", loadOrders);
logoutBtn.addEventListener("click", () => logout());

if (token) showPanel();
