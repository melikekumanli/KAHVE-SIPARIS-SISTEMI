// Ortama göre backend URL'si
const backendURL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:3000"
  : "https://senin-canli-api-adresin.com";

const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const messageEl = document.getElementById("message");
const listEl = document.getElementById("orderList");
const emptyInfoEl = document.getElementById("emptyInfo");

let messageTimer;
function showMessage(text, type) {
  clearTimeout(messageTimer);
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.hidden = false;
  messageTimer = setTimeout(() => { messageEl.hidden = true; }, 5000);
}

function renderOrders(orders) {
  listEl.innerHTML = "";
  emptyInfoEl.hidden = orders.length > 0;

  // En yeni sipariş en üstte
  [...orders].reverse().forEach((order) => {
    const li = document.createElement("li");
    li.textContent =
      `${order.name} - ${order.type} (${order.size})` +
      (order.note ? ` | Not: ${order.note}` : "");
    listEl.appendChild(li);
  });
}

async function loadOrders() {
  try {
    const response = await fetch(`${backendURL}/api/orders`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderOrders(await response.json());
  } catch (error) {
    console.error("Siparişler yüklenemedi:", error);
    showMessage("Siparişler yüklenemedi. Sunucu çalışıyor mu?", "error");
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submitBtn.disabled) return; // çift gönderimi engelle

  const data = Object.fromEntries(new FormData(form).entries());

  submitBtn.disabled = true;
  submitBtn.textContent = "Gönderiliyor...";

  try {
    const response = await fetch(`${backendURL}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      form.reset();
      showMessage("Siparişin alındı, teşekkürler!", "success");
      await loadOrders();
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
    submitBtn.textContent = "Gönder";
  }
});

loadOrders();
