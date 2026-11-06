const { openDb } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

// Yerelde live-server adreslerine izin verilir. Canlıda ALLOWED_ORIGIN
// ortam değişkeni ile (virgülle ayrılmış) frontend adresi belirtilmelidir.
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5500', 'http://127.0.0.1:5500'];

// Yönetici anahtarı. Canlıda mutlaka ADMIN_TOKEN ile ayarlanmalıdır.
let adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Canlı ortamda ADMIN_TOKEN ayarlanmalıdır.');
    process.exit(1);
  }
  adminToken = 'barista';
  console.warn('⚠️  ADMIN_TOKEN ayarlı değil, geliştirme anahtarı kullanılıyor: "barista"');
}

const db = openDb();
const app = createApp(db, { adminToken, allowedOrigins });

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
