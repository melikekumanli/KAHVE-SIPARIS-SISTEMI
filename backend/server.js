const cors = require('cors');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = path.join(__dirname, 'orders.json');

const COFFEE_TYPES = ['Türk Kahvesi', 'Latte', 'Espresso'];
const SIZES = ['Küçük', 'Orta', 'Büyük'];

app.use(express.json({ limit: '10kb' }));
// Yerelde live-server adreslerine izin verilir. Canlıda ALLOWED_ORIGIN
// ortam değişkeni ile (virgülle ayrılmış) frontend adresi belirtilmelidir.
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5500', 'http://127.0.0.1:5500'];
app.use(cors({ origin: allowedOrigins }));

async function readOrders() {
  try {
    const data = await fs.readFile(FILE_PATH, 'utf-8');
    return data.trim() ? JSON.parse(data) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Eşzamanlı isteklerde siparişlerin birbirini ezmemesi için yazmalar sıraya alınır.
let writeQueue = Promise.resolve();
function addOrder(order) {
  const task = writeQueue.then(async () => {
    const orders = await readOrders();
    orders.push(order);
    await fs.writeFile(FILE_PATH, JSON.stringify(orders, null, 2));
    return order;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function validateOrder(body) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!name) errors.push('İsim zorunludur.');
  else if (name.length > 50) errors.push('İsim en fazla 50 karakter olabilir.');
  if (!COFFEE_TYPES.includes(body.type)) errors.push('Geçersiz kahve türü.');
  if (!SIZES.includes(body.size)) errors.push('Geçersiz boyut.');
  if (note.length > 200) errors.push('Not en fazla 200 karakter olabilir.');

  return { errors, order: { name, type: body.type, size: body.size, note } };
}

// Yeni sipariş ekleme
app.post('/api/orders', async (req, res, next) => {
  try {
    const { errors, order } = validateOrder(req.body || {});
    if (errors.length) return res.status(400).json({ errors });

    const saved = await addOrder({
      id: crypto.randomUUID(),
      ...order,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ message: 'Sipariş başarıyla kaydedildi.', order: saved });
  } catch (err) {
    next(err);
  }
});

// Tüm siparişleri getirme
app.get('/api/orders', async (req, res, next) => {
  try {
    res.json(await readOrders());
  } catch (err) {
    next(err);
  }
});

// Hata yakalayıcı (bozuk JSON gövdesi, dosya hatası vb.)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errors: ['Geçersiz JSON.'] });
  }
  console.error(err);
  res.status(500).json({ errors: ['Sunucu hatası oluştu.'] });
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
