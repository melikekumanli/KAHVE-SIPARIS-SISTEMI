const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, DATA_DIR } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// Barista anahtarı: ADMIN_TOKEN ortam değişkeni varsa o kullanılır; yoksa ilk açılışta
// rastgele bir anahtar üretilir ve data/admin-token.txt dosyasına kaydedilir.
function getAdminToken() {
  if (process.env.ADMIN_TOKEN) return { token: process.env.ADMIN_TOKEN, source: 'ADMIN_TOKEN ortam değişkeni' };
  const file = path.join(DATA_DIR, 'admin-token.txt');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file, 'utf-8').trim();
    if (saved) return { token: saved, source: file };
  }
  const token = crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(file, token + '\n');
  return { token, source: file };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const { token: adminToken, source } = getAdminToken();

const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim())
  : [];

const db = openDb();
const app = createApp(db, { adminToken, allowedOrigins, staticDir: FRONTEND_DIR });

// 0.0.0.0: aynı ağdaki telefon ve tabletler de bağlanabilsin
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n☕ Kahve Sipariş Sistemi çalışıyor\n');
  console.log(`  Bu bilgisayardan : http://localhost:${PORT}`);
  lanAddresses().forEach((ip) => console.log(`  Ağdaki cihazlar   : http://${ip}:${PORT}`));
  console.log(`\n  Barista paneli   : /admin.html`);
  console.log(`  Barista anahtarı : ${adminToken}   (${source})\n`);
});
