# ☕ Kahve Sipariş Sistemi

Bir kahve dükkanının müşterilerinden web üzerinden sipariş almasını sağlayan, basit ama işlevsel bir full-stack web uygulaması.

<img width="502" height="609" alt="Ekran görüntüsü 2025-07-29 124914" src="https://github.com/user-attachments/assets/408bd84e-05a6-47fd-922f-8ae6b4a522c2" />

<img width="493" height="608" alt="Ekran görüntüsü 2025-07-29 124945" src="https://github.com/user-attachments/assets/83f9c173-ca06-43bf-83b9-83061e673342" />

<img width="521" height="124" alt="Ekran görüntüsü 2025-07-29 125009" src="https://github.com/user-attachments/assets/e2d72e17-72ee-4baf-acff-0f0a67c4d36a" />

## 🔧 Özellikler

**Müşteri (`index.html`)**
- Menüden kahve türü ve boyut seçme; fiyat ve toplam tutar anında görünür.
- "Siparişlerim" bölümünde kendi siparişlerinin durumunu (Bekliyor → Hazırlanıyor → Hazır → Teslim Edildi) canlı takip etme.
- Sayfa içi başarı/hata bildirimi, çift gönderim koruması, mobil uyumlu arayüz.

**Barista (`admin.html`)**
- Yönetici anahtarıyla giriş.
- Tüm siparişleri görme, duruma göre filtreleme, durum güncelleme ve silme.

**Backend**
- Siparişler SQLite veritabanında saklanır.
- Sunucu tarafı doğrulama, hata yönetimi, fiyat hesabı (fiyatı istemci belirleyemez).
- Otomatik API testleri.

## 🛠️ Kullanılan Teknolojiler

| Katman         | Teknoloji                         |
|----------------|-----------------------------------|
| Frontend       | HTML, CSS, vanilla JavaScript     |
| Backend        | Node.js (>= 22.5) + Express 5 + cors |
| Veritabanı     | SQLite (Node'un yerleşik `node:sqlite` modülü, ek paket gerekmez) |
| Test           | Node'un yerleşik test çalıştırıcısı (`node:test`) |
| Geliştirme     | `live-server`, `concurrently`     |
| Kolay başlatma | `baslat.bat` (Windows)            |

## 📁 Proje Yapısı

```
KAHVE-SIPARIS-SISTEMI/
├── backend/
│   ├── server.js        # Sunucuyu başlatır (port, CORS, yönetici anahtarı)
│   ├── app.js           # Express uygulaması: uç noktalar ve doğrulama
│   ├── db.js            # SQLite bağlantısı ve tablo
│   ├── menu.js          # Menü, fiyatlar ve sipariş durumları
│   ├── api.test.js      # API testleri
│   └── orders.db        # Veritabanı dosyası (otomatik oluşur, git'e girmez)
├── frontend/
│   ├── index.html, script.js   # Müşteri sayfası
│   ├── admin.html, admin.js    # Barista paneli
│   ├── config.js               # Backend adresi
│   └── style.css
├── baslat.bat           # Tek tıkla başlatma (Windows)
├── package.json         # Bağımlılıklar ve scriptler
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

**Testleri çalıştırmak için:**
```bash
npm test
```

**Barista paneli:** http://localhost:5500/admin.html. Geliştirme ortamında varsayılan anahtar `barista`'dır (aşağıdaki "Yapılandırma" bölümüne bakın).

## 🔌 API

| Metot  | Adres                        | Erişim  | Açıklama |
|--------|------------------------------|---------|----------|
| GET    | `/api/menu`                  | Herkes  | Menü, fiyatlar ve durum listesi |
| POST   | `/api/orders`                | Herkes  | Yeni sipariş oluşturur |
| GET    | `/api/orders/:id`            | Herkes  | Tek siparişin durumu (id tahmin edilemez bir UUID'dir) |
| GET    | `/api/orders?status=Hazır`   | Barista | Tüm siparişler (isteğe bağlı durum filtresi) |
| PATCH  | `/api/orders/:id/status`     | Barista | Sipariş durumunu günceller |
| DELETE | `/api/orders/:id`            | Barista | Siparişi siler |

Barista uçları `x-admin-token` başlığı ister; yanlışsa `401` döner.

**POST gövdesi:**
```json
{ "name": "Melike", "type": "Latte", "size": "Orta", "note": "karamelli" }
```

**Kurallar:**
- `name`: zorunlu, en fazla 50 karakter
- `type`: `Türk Kahvesi`, `Latte` veya `Espresso`
- `size`: `Küçük`, `Orta` veya `Büyük`
- `note`: opsiyonel, en fazla 200 karakter
- Fiyat ve durum istemciden alınmaz: fiyat sunucuda hesaplanır, yeni sipariş her zaman `Bekliyor` ile başlar.

**Başarılı yanıt (`201`):** kaydedilen sipariş `id`, `price`, `status`, `createdAt`, `updatedAt` alanlarıyla döner.
**Hatalı istek (`400`):** `{ "errors": ["İsim zorunludur."] }` gibi bir hata listesi döner.

## ⚙️ Yapılandırma

| Ortam değişkeni  | Varsayılan | Açıklama |
|------------------|------------|----------|
| `PORT`           | `3000` | Backend portu |
| `ALLOWED_ORIGIN` | `http://localhost:5500`, `http://127.0.0.1:5500` | CORS ile izin verilen frontend adresleri (virgülle ayrılır) |
| `ADMIN_TOKEN`    | `barista` (sadece geliştirmede) | Barista anahtarı. `NODE_ENV=production` iken ayarlanmazsa sunucu başlamaz |
| `DB_PATH`        | `backend/orders.db` | SQLite dosyasının yolu |

Canlıya alırken `frontend/config.js` içindeki `senin-canli-api-adresin.com` yer tutucusunu gerçek API adresiyle değiştirin; backend'i `ALLOWED_ORIGIN` ve güçlü bir `ADMIN_TOKEN` ile başlatın.

## ⚠️ Bilinen Sınırlamalar

- Yönetici girişi tek bir paylaşılan anahtara dayanır; kullanıcı hesabı ve oturum yönetimi yoktur.
- Müşteri siparişlerini tarayıcısında (localStorage) hatırlar; başka cihazdan görünmez.
- Durum takibi 5 saniyelik yoklama (polling) ile yapılır, anlık bildirim (WebSocket) yoktur.
- `node:sqlite` Node'da henüz deneysel olarak işaretlidir.

## 👤 Geliştiren

**Melike Kumanlı**
Yönetim Bilişim Sistemleri 4. sınıf öğrencisi.
Bu proje yazılım geliştirme staj başvurusuna özel olarak hazırlanmıştır.
