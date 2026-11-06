# ☕ Kahve Sipariş Sistemi

Bir kahve dükkanının müşterilerinden web üzerinden sipariş almasını sağlayan, basit ama işlevsel bir full-stack web uygulaması.

<img width="502" height="609" alt="Ekran görüntüsü 2025-07-29 124914" src="https://github.com/user-attachments/assets/408bd84e-05a6-47fd-922f-8ae6b4a522c2" />

<img width="493" height="608" alt="Ekran görüntüsü 2025-07-29 124945" src="https://github.com/user-attachments/assets/83f9c173-ca06-43bf-83b9-83061e673342" />

<img width="521" height="124" alt="Ekran görüntüsü 2025-07-29 125009" src="https://github.com/user-attachments/assets/e2d72e17-72ee-4baf-acff-0f0a67c4d36a" />

## 🔧 Özellikler

- Form ile kahve siparişi verme (isim, kahve türü, boyut, not).
- Siparişler JSON olarak backend'e gönderilir, doğrulanır ve `backend/orders.json` dosyasına kaydedilir.
- Verilen tüm siparişler sayfada listelenir (en yeni üstte).
- Sayfa içi başarı/hata bildirimi, çift gönderim koruması, mobil uyumlu arayüz.
- Backend tarafında doğrulama, hata yönetimi ve eşzamanlı yazma koruması.

## 🛠️ Kullanılan Teknolojiler

| Katman         | Teknoloji                         |
|----------------|-----------------------------------|
| Frontend       | HTML, CSS, vanilla JavaScript     |
| Backend        | Node.js + Express 5 + cors        |
| Veri saklama   | `backend/orders.json` (JSON dosyası, veritabanı yok) |
| Geliştirme     | `live-server`, `concurrently`     |
| Kolay başlatma | `baslat.bat` (Windows)            |

## 📁 Proje Yapısı

```
KAHVE-SIPARIS-SISTEMI/
├── backend/
│   ├── server.js        # Express API
│   └── orders.json      # Siparişlerin saklandığı dosya
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── .vscode/launch.json  # VS Code'dan Chrome ile açma ayarı
├── baslat.bat           # Tek tıkla başlatma (Windows)
├── package.json         # Tüm bağımlılıklar ve scriptler (tek dosya)
└── README.md
```

## 🚀 Kurulum ve Çalıştırma

**Gereksinim:** [Node.js](https://nodejs.org) yüklü olmalı.

```bash
# 1. Projeyi indir
git clone https://github.com/melikekumanli/KAHVE-SIPARIS-SISTEMI.git
cd KAHVE-SIPARIS-SISTEMI

# 2. Paketleri kur (sadece ilk seferde, kök klasörde)
npm install

# 3. Backend ve frontend'i birlikte başlat
npm start
```

| Servis   | Adres                   |
|----------|-------------------------|
| Frontend | http://localhost:5500   |
| Backend  | http://localhost:3000   |

**Windows'ta tek tıkla:** `npm install` yapıldıktan sonra `baslat.bat` dosyasına çift tıklayın.

**Ayrı ayrı başlatmak için:**
```bash
npm run server   # sadece backend (port 3000)
npm run client   # sadece frontend (port 5500)
```

## 🔌 API

| Metot | Adres          | Açıklama                      |
|-------|----------------|-------------------------------|
| POST  | `/api/orders`  | Yeni sipariş oluşturur        |
| GET   | `/api/orders`  | Tüm siparişleri listeler      |

**POST gövdesi:**
```json
{ "name": "Melike", "type": "Latte", "size": "Orta", "note": "karamelli" }
```

**Kurallar:**
- `name`: zorunlu, en fazla 50 karakter
- `type`: `Türk Kahvesi`, `Latte` veya `Espresso`
- `size`: `Küçük`, `Orta` veya `Büyük`
- `note`: opsiyonel, en fazla 200 karakter

**Başarılı yanıt (`201`):** kaydedilen sipariş, sunucunun eklediği `id` ve `createdAt` alanlarıyla birlikte döner.
**Hatalı istek (`400`):** `{ "errors": ["İsim zorunludur."] }` gibi bir hata listesi döner.

## ⚙️ Yapılandırma

| Ortam değişkeni  | Varsayılan                                      | Açıklama |
|------------------|-------------------------------------------------|----------|
| `PORT`           | `3000`                                          | Backend portu |
| `ALLOWED_ORIGIN` | `http://localhost:5500`, `http://127.0.0.1:5500` | CORS ile izin verilen frontend adresleri (virgülle ayrılır) |

Canlıya alırken `frontend/script.js` içindeki `senin-canli-api-adresin.com` yer tutucusunu gerçek API adresiyle değiştirin ve backend'i `ALLOWED_ORIGIN` ile başlatın.

## ⚠️ Bilinen Sınırlamalar

- Veri bir JSON dosyasında tutulur; gerçek bir veritabanı yoktur.
- Kimlik doğrulama yoktur: `GET /api/orders` tüm siparişleri herkese gösterir.
- Sipariş silme/güncelleme ve sipariş durumu takibi yoktur.

## 👤 Geliştiren

**Melike Kumanlı**
Yönetim Bilişim Sistemleri 4. sınıf öğrencisi.
Bu proje yazılım geliştirme staj başvurusuna özel olarak hazırlanmıştır.
