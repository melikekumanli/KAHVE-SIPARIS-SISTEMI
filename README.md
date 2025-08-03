Kahve Sipariş Sistemi 

Bu proje, bir kahve dükkanının müşterilerinden web üzerinden sipariş almasını sağlayan basit ama işlevsel bir full-stack web uygulamasıdır. 

<img width="502" height="609" alt="Ekran görüntüsü 2025-07-29 124914" src="https://github.com/user-attachments/assets/408bd84e-05a6-47fd-922f-8ae6b4a522c2" />

<img width="493" height="608" alt="Ekran görüntüsü 2025-07-29 124945" src="https://github.com/user-attachments/assets/83f9c173-ca06-43bf-83b9-83061e673342" />


<img width="521" height="124" alt="Ekran görüntüsü 2025-07-29 125009" src="https://github.com/user-attachments/assets/e2d72e17-72ee-4baf-acff-0f0a67c4d36a" />



 Özellikler 

Kullanıcı form ile kahve siparişi verebilir (isim, tür, boyut, not). 

Siparişler JSON formatında backend'e gönderilir ve kaydedilir. 

Sipariş verildiğinde, son sipariş kullanıcıya ekranda gösterilir. 

Basit, şık ve kullanıcı dostu arayüz. 

Hem teknik kullanıcılar hem de teknik olmayan kişiler için çalıştırılabilir. 

 

 Kullanılan Teknolojiler 

Frontend: HTML, CSS, JavaScript 

Backend: Node.js + Express 

Veri Saklama: orders.json 

Yardımcılar: live-server, concurrently 

Kolay Başlatma: .bat dosyaları (Windows) 

 

 Kurulum 

1. Gerekli Yazılımlar: 

Node.js yüklü olmalı 

2. Projeyi İndir 

GitHub'dan zip indir veya terminal ile klonla
cd kahve-siparis-sistemi 
  

3. Paketleri Kur (İlk defa yapılıyorsa) 

cd backend 
npm install 
  
 


## 🚀 Projeyi Çalıştırma Yöntemleri

### ✅ 1. Tek Tıklamayla (Windows için önerilen)

`calistir.bat` dosyasına çift tıklayın.  
Bu dosya hem backend sunucusunu başlatır hem de frontend arayüzünü tarayıcıda açar.

**calistir.bat içeriği:**
```bat
start cmd /k "cd backend && node server.js"
start cmd /k "npx live-server frontend"
```


### 💻 2. Manuel Yöntem (Geliştiriciler için)

**Backend başlatmak için:**
```bash
cd backend
npm install
node server.js
```

**Frontend başlatmak için:**
```bash
npx live-server frontend
```
Alternatif olarak, `frontend/index.html` dosyasını VS Code’da sağ tıklayıp **"Open with Live Server"** ile açabilirsiniz.

---

#🔁 3. Otomatik Başlatma (`concurrently` ile)

Hem backend hem frontend’i aynı anda başlatmak için:

**Kurulum:**
```bash
npm install
```

**Çalıştırma:**
```bash
npm run dev
```

**package.json > scripts kısmı:**
```json
"scripts": {
  "dev": "concurrently \"cd backend && node server.js\" \"npx live-server frontend\""
}
```


 Proje Dosya Yapısı 

kahve-siparis-sistemi/ 
├── backend/ 
│   ├── server.js 
│   ├── orders.json 
│   └── package.json 
├── frontend/ 
│   ├── index.html 
│   ├── style.css 
│   └── script.js 
├── calistir.bat 
├── README.md 
  

 Geliştiren 

Melike Kumanlı 

Yönetim Bilişim Sistemleri 4.sınıf öğrencisi. 

Bu proje, yazılım geliştirme staj başvurum için hazırlanmıştır.

