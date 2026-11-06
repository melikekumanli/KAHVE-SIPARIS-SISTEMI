const cors = require('cors');
const express = require('express');
const crypto = require('crypto');
const { toOrder } = require('./db');
const { STATUSES, validateItem, validateSizes, createMenu } = require('./menu');
const { createRateLimiter } = require('./rateLimiter');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createApp(db, options) {
  const {
    adminToken,
    allowedOrigins = [],      // Frontend backend'den sunulduğu için varsayılan: çapraz kaynak yok
    staticDir = null,         // Verilirse frontend dosyaları buradan sunulur
    orderLimit = { windowMs: 60_000, max: 10 },     // IP başına dakikada en fazla 10 sipariş
    loginLimit = { windowMs: 15 * 60_000, max: 10 }, // IP başına 15 dakikada en fazla 10 hatalı anahtar
  } = options;

  const menu = createMenu(db);
  const orderLimiter = createRateLimiter(orderLimit);
  const loginLimiter = createRateLimiter(loginLimit);

  const app = express();
  app.use(express.json({ limit: '10kb' }));
  if (allowedOrigins.length) app.use(cors({ origin: allowedOrigins }));

  // Sadece barista (yönetici) işlemleri için: x-admin-token başlığı gerekir.
  // Çok sayıda hatalı deneme yapan IP geçici olarak engellenir.
  function requireAdmin(req, res, next) {
    if (loginLimiter.blocked(req.ip)) {
      return res.status(429).json({ errors: ['Çok fazla hatalı deneme. Lütfen biraz bekleyin.'] });
    }
    const token = req.get('x-admin-token');
    if (!token || !safeEqual(token, adminToken)) {
      loginLimiter.hit(req.ip);
      return res.status(401).json({ errors: ['Yetkisiz: geçerli yönetici anahtarı gerekli.'] });
    }
    next();
  }

  const parseId = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) ? id : null;
  };

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, name, type, size, note, price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Bekliyor', ?, ?)`
  );
  const selectById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const selectAll = db.prepare('SELECT * FROM orders ORDER BY created_at DESC, rowid DESC');
  const selectByStatus = db.prepare(
    'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC, rowid DESC'
  );
  const updateStatus = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?');
  const deleteById = db.prepare('DELETE FROM orders WHERE id = ?');

  // ---------- Menü ----------

  // Menü, fiyatlar, boyutlar ve durum listesi (herkese açık)
  app.get('/api/menu', (req, res) => res.json(menu.getMenu()));

  app.post('/api/menu/items', requireAdmin, (req, res) => {
    const { errors, data } = validateItem(req.body || {});
    if (errors.length) return res.status(400).json({ errors });
    if (menu.findItem(data.name)) {
      return res.status(409).json({ errors: [`"${data.name}" zaten menüde var.`] });
    }
    res.status(201).json(menu.createItem(data));
  });

  app.patch('/api/menu/items/:id', requireAdmin, (req, res) => {
    const id = parseId(req);
    const current = id === null ? null : menu.findItemById(id);
    if (!current) return res.status(404).json({ errors: ['Ürün bulunamadı.'] });

    const { errors, data } = validateItem(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ errors });
    if (data.name && data.name !== current.name && menu.findItem(data.name)) {
      return res.status(409).json({ errors: [`"${data.name}" zaten menüde var.`] });
    }
    res.json(menu.updateItem(id, data));
  });

  // Silinen ürünün eski siparişleri etkilenmez: siparişte ad ve fiyat kopyası saklanır.
  app.delete('/api/menu/items/:id', requireAdmin, (req, res) => {
    const id = parseId(req);
    if (id === null || !menu.deleteItem(id)) {
      return res.status(404).json({ errors: ['Ürün bulunamadı.'] });
    }
    res.status(204).end();
  });

  // Boyut listesini topluca değiştirir
  app.put('/api/menu/sizes', requireAdmin, (req, res) => {
    const { errors, sizes } = validateSizes(req.body);
    if (errors.length) return res.status(400).json({ errors });
    menu.replaceSizes(sizes);
    res.json(menu.getMenu().sizes);
  });

  // ---------- Siparişler ----------

  // Yeni sipariş (herkese açık)
  app.post('/api/orders', (req, res) => {
    if (orderLimiter.blocked(req.ip)) {
      return res.status(429).json({ errors: ['Çok fazla sipariş gönderdiniz. Lütfen biraz bekleyin.'] });
    }

    const body = req.body || {};
    const errors = [];
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';

    if (!name) errors.push('İsim zorunludur.');
    else if (name.length > 50) errors.push('İsim en fazla 50 karakter olabilir.');
    if (note.length > 200) errors.push('Not en fazla 200 karakter olabilir.');

    const item = typeof body.type === 'string' ? menu.findItem(body.type) : null;
    if (!item) errors.push('Geçersiz kahve türü.');
    else if (!item.available) errors.push(`${item.name} şu an mevcut değil (tükendi).`);

    const size = typeof body.size === 'string' ? menu.findSize(body.size) : null;
    if (!size) errors.push('Geçersiz boyut.');

    if (errors.length) return res.status(400).json({ errors });

    orderLimiter.hit(req.ip);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    insertOrder.run(id, name, item.name, size.name, note, item.price + size.extra, now, now);
    res.status(201).json({
      message: 'Sipariş başarıyla kaydedildi.',
      order: toOrder(selectById.get(id)),
    });
  });

  // Tek siparişin durumu: id tahmin edilemez bir UUID olduğu için herkese açık.
  // Müşteri kendi siparişini bu uçtan takip eder.
  app.get('/api/orders/:id', (req, res) => {
    const order = toOrder(selectById.get(req.params.id));
    if (!order) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.json(order);
  });

  // Tüm siparişler (yönetici). İsteğe bağlı: ?status=Bekliyor
  app.get('/api/orders', requireAdmin, (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ errors: ['Geçersiz durum filtresi.'] });
    }
    const rows = status ? selectByStatus.all(status) : selectAll.all();
    res.json(rows.map(toOrder));
  });

  // Sipariş durumunu güncelleme (yönetici)
  app.patch('/api/orders/:id/status', requireAdmin, (req, res) => {
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ errors: [`Durum şunlardan biri olmalı: ${STATUSES.join(', ')}.`] });
    }
    const { changes } = updateStatus.run(status, new Date().toISOString(), req.params.id);
    if (!changes) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.json(toOrder(selectById.get(req.params.id)));
  });

  // Sipariş silme (yönetici)
  app.delete('/api/orders/:id', requireAdmin, (req, res) => {
    const { changes } = deleteById.run(req.params.id);
    if (!changes) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.status(204).end();
  });

  // Frontend dosyaları
  if (staticDir) app.use(express.static(staticDir));

  // Hata yakalayıcı (bozuk JSON gövdesi, veritabanı hatası vb.)
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ errors: ['Geçersiz JSON.'] });
    }
    console.error(err);
    res.status(500).json({ errors: ['Sunucu hatası oluştu.'] });
  });

  return app;
}

module.exports = { createApp };
