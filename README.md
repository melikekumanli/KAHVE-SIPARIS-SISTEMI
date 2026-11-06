# ☕ Kahve Sipariş Sistemi

Bir kafenin kendi bilgisayarında çalıştırıp **yerel ağdaki (Wi-Fi) telefon ve tabletlerden** sipariş alabildiği, menüsü yönetilebilir sipariş sistemi. İnternet bağlantısı, hosting veya ek yazılım gerekmez.

<img width="502" height="609" alt="Ekran görüntüsü 2025-07-29 124914" src="https://github.com/user-attachments/assets/408bd84e-05a6-47fd-922f-8ae6b4a522c2" />

<img width="493" height="608" alt="Ekran görüntüsü 2025-07-29 124945" src="https://github.com/user-attachments/assets/83f9c173-ca06-43bf-83b9-83061e673342" />

<img width="521" height="124" alt="Ekran görüntüsü 2025-07-29 125009" src="https://github.com/user-attachments/assets/e2d72e17-72ee-4baf-acff-0f0a67c4d36a" />

## 🔧 Özellikler

**Müşteri (`/`)**
- Menüden ürün ve boyut seçme; fiyat ve toplam tutar anında görünür.
- Ürünler kategoriye göre gruplanır; tükenen ürünler "Tükendi" olarak gösterilir ve seçilemez.
- Sipariş sonrası **sipariş numarası** (her gün 1'den başlar) ve "Siparişlerim" bölümünde durum takibi (Bekliyor → Hazırlanıyor → Hazır → Teslim Edildi), ilerleme çubuğuyla.
- Telefondan rahat kullanım, girilen ismin hatırlanması, çift gönderim koruması.

**Personel paneli (`/admin.html`)**
- Yönetici anahtarıyla giriş; bekleyen / hazırlanan / teslime hazır sipariş sayaçları.
- **Siparişler:** tek tıkla bir sonraki aşamaya geçirme ("Hazırlamaya başla" → "Hazır" → "Teslim edildi"), geri alma, duruma göre filtreleme, silme. Yeni sipariş gelince **sesli uyarı** ve sekme başlığında bekleyen sayısı: `(3) Personel Paneli · Kafe Adı`.
- **Arşiv:** teslim edilen siparişler aktif listeden çıkar ve "Arşiv" görünümünde saklanır; panel günlerce çalışsa da hızlı kalır.
- **Fiş:** her sipariş için 80 mm termal yazıcıya uygun fiş yazdırma (kafe adı, sipariş no, ürün, tutar).
- **Menü yönetimi:** ürün ekleme/silme, ad-kategori-fiyat düzenleme, "tükendi" işaretleme, boyut ve boyut ücretlerini değiştirme.
- **Ayarlar (marka):** kafe adı, slogan ve 4 renk temasından seçim; müşteri sayfasına, sekme başlığına ve fişe yansır.

**Güvenlik ve güvenilirlik**
- Barista anahtarı ilk açılışta rastgele üretilir (tahmin edilebilir varsayılan yok).
- Hatalı anahtar denemeleri ve aşırı sipariş gönderimi hız sınırıyla engellenir.
- Fiyat her zaman sunucuda hesaplanır; istemci fiyatı/durumu değiştiremez.
- Siparişte ürün adı ve fiyat kopyası saklanır: menüyü değiştirmek eski siparişleri bozmaz.
- 28 otomatik API testi (doğrulama, yetki, hız sınırı, arşiv, ayarlar, eski veritabanı yükseltme).

## 🛠️ Kullanılan Teknolojiler

| Katman       | Teknoloji                         |
|--------------|-----------------------------------|
| Frontend     | HTML, CSS, vanilla JavaScript     |
| Backend      | Node.js (>= 22.5) + Express 5     |
| Veritabanı   | SQLite (Node'un yerleşik `node:sqlite` modülü) |
| Test         | Node'un yerleşik test çalıştırıcısı (`node:test`) |

Sunucu hem API'yi hem de frontend dosyalarını sunar: tek program, tek port, ek araç yok.

## 🚀 Kurulum ve Çalıştırma

**Gereksinim:** [Node.js](https://nodejs.org) 22.5 veya üstü.

```bash
git clone https://github.com/melikekumanli/KAHVE-SIPARIS-SISTEMI.git
cd KAHVE-SIPARIS-SISTEMI
npm install
npm start
```

**Windows'ta tek tıkla:** `baslat.bat` dosyasına çift tıklayın (ilk seferde paketleri kurar, tarayıcıyı açar).

Sunucu açılınca konsolda şuna benzer bir çıktı görürsünüz:

```
  Bu bilgisayardan : http://localhost:3000
  Ağdaki cihazlar  : http://192.168.1.20:3000
  Barista paneli   : /admin.html
  Barista anahtarı : 9c6ab2bbbc72
```

- **Müşteriler** telefondan "Ağdaki cihazlar" adresini açar (aynı Wi-Fi'da olmalıdır). Kolaylık için bu adresi QR koda çevirip masalara koyabilirsiniz.
- **Personel** aynı adrese `/admin.html` ekleyerek girer ve konsoldaki anahtarı yazar. Anahtar `data/admin-token.txt` dosyasında da saklanır.

> **Windows Güvenlik Duvarı:** İlk çalıştırmada Windows "Node.js'in ağ erişimine izin verilsin mi?" diye sorar. Telefonların bağlanabilmesi için **Özel ağlar**'a izin verin.

**Testleri çalıştırmak için:** `npm test`

## 📁 Proje Yapısı

```
KAHVE-SIPARIS-SISTEMI/
├── backend/
│   ├── server.js        # Sunucuyu başlatır (port, ağ adresleri, barista anahtarı)
│   ├── app.js           # Express uygulaması: tüm uç noktalar
│   ├── db.js            # SQLite bağlantısı, tablolar, varsayılan menü
│   ├── menu.js          # Menü işlemleri ve doğrulama
│   ├── settings.js      # Marka ayarları (ad, slogan, tema)
│   ├── rateLimiter.js   # Hız sınırlayıcı
│   └── api.test.js      # API testleri
├── frontend/
│   ├── index.html, script.js   # Müşteri sayfası
│   ├── admin.html, admin.js    # Personel paneli
│   ├── brand.js                # Kafe adı/tema uygulayıcı (iki sayfada ortak)
│   └── style.css               # Tasarım sistemi (renk değişkenleri, temalar, yazdırma)
├── data/                # Veritabanı ve barista anahtarı (otomatik oluşur, git'e girmez)
├── baslat.bat           # Tek tıkla başlatma (Windows)
└── package.json
```

## 💾 Veri ve Yedekleme

Tüm veri (siparişler ve menü) `data/orders.db` dosyasındadır. **Yedeklemek için sunucu kapalıyken bu klasörü kopyalamanız yeterlidir.** Yeni bir bilgisayara taşırken de `data/` klasörünü kopyalayın.

## 🔌 API

| Metot  | Adres                       | Erişim  | Açıklama |
|--------|-----------------------------|---------|----------|
| GET    | `/api/menu`                 | Herkes  | Ürünler, boyutlar, durum listesi |
| POST   | `/api/orders`               | Herkes  | Yeni sipariş |
| GET    | `/api/orders/:id`           | Herkes  | Tek siparişin durumu (id tahmin edilemez bir UUID'dir) |
| GET    | `/api/orders`               | Barista | Siparişler. Filtreler: `?scope=active` (arşiv hariç), `?status=Hazır`, `?limit=100` |
| PATCH  | `/api/orders/:id/status`    | Barista | Sipariş durumunu günceller |
| DELETE | `/api/orders/:id`           | Barista | Siparişi siler |
| POST   | `/api/menu/items`           | Barista | Ürün ekler |
| PATCH  | `/api/menu/items/:id`       | Barista | Ürünü günceller (ad, kategori, fiyat, `available`) |
| DELETE | `/api/menu/items/:id`       | Barista | Ürünü siler |
| PUT    | `/api/menu/sizes`           | Barista | Boyut listesini değiştirir |
| GET    | `/api/settings`             | Herkes  | Kafe adı, slogan, tema |
| PUT    | `/api/settings`             | Barista | Marka ayarlarını günceller |

Barista uçları `x-admin-token` başlığı ister; yanlışsa `401`, çok fazla hatalı denemede `429` döner.

**Sipariş gövdesi:** `{ "name": "Melike", "type": "Latte", "size": "Orta", "note": "karamelli" }`
`type` ve `size` menüde var olmalıdır; tükenmiş ürün sipariş edilemez. Hatalarda `400` ve `{ "errors": ["..."] }` döner.

## ⚙️ Yapılandırma (isteğe bağlı)

| Ortam değişkeni  | Varsayılan            | Açıklama |
|------------------|-----------------------|----------|
| `PORT`           | `3000`                | Sunucu portu |
| `ADMIN_TOKEN`    | otomatik üretilir     | Barista anahtarını kendiniz belirlemek için |
| `DB_PATH`        | `data/orders.db`      | Veritabanı dosyasının yolu |
| `ALLOWED_ORIGIN` | (yok)                 | Frontend'i başka bir adresten sunacaksanız CORS izni (virgülle ayrılır) |

Örnek (PowerShell): `$env:PORT=8080; npm start`

## ⚠️ Bilinen Sınırlamalar

- Tek paylaşılan barista anahtarı vardır; kullanıcı hesabı ve oturum yönetimi yoktur. **Sunucuyu internete açmayın**, yerel ağ için tasarlanmıştır (trafik şifrelenmez, HTTPS yoktur).
- Müşteri siparişlerini tarayıcısında hatırlar; başka cihazdan görünmez.
- Durum takibi ve yeni sipariş bildirimi birkaç saniyelik yoklama ile yapılır (anlık değildir).
- Ödeme, masa numarası ve ciro raporlama yoktur.
- Logo dosyası yüklenmez; logo yerine kafe adının baş harfi kullanılır.
- `node:sqlite` Node'da henüz deneysel olarak işaretlidir.

## 👤 Geliştiren

**Melike Kumanlı**
Yönetim Bilişim Sistemleri 4. sınıf öğrencisi.
