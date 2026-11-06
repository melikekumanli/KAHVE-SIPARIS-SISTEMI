const cors = require('cors');
const express = require('express');
const crypto = require('crypto');
const { toOrder } = require('./db');
const { COFFEES, SIZES, STATUSES, calculatePrice, getMenu } = require('./menu');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validateOrder(body) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!name) errors.push('İsim zorunludur.');
  else if (name.length > 50) errors.push('İsim en fazla 50 karakter olabilir.');
  if (!Object.hasOwn(COFFEES, body.type)) errors.push('Geçersiz kahve türü.');
  if (!Object.hasOwn(SIZES, body.size)) errors.push('Geçersiz boyut.');
  if (note.length > 200) errors.push('Not en fazla 200 karakter olabilir.');

  return { errors, order: { name, type: body.type, size: body.size, note } };
}

function createApp(db, { adminToken, allowedOrigins }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(cors({ origin: allowedOrigins }));

  // Sadece barista (yönetici) işlemleri için: x-admin-token başlığı gerekir.
  function requireAdmin(req, res, next) {
    const token = req.get('x-admin-token');
    if (!token || !safeEqual(token, adminToken)) {
      return res.status(401).json({ errors: ['Yetkisiz: geçerli yönetici anahtarı gerekli.'] });
    }
    next();
  }

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

  // Menü ve fiyatlar (herkese açık)
  app.get('/api/menu', (req, res) => res.json(getMenu()));

  // Yeni sipariş (herkese açık)
  app.post('/api/orders', (req, res) => {
    const { errors, order } = validateOrder(req.body || {});
    if (errors.length) return res.status(400).json({ errors });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    insertOrder.run(
      id, order.name, order.type, order.size, order.note,
      calculatePrice(order.type, order.size), now, now
    );
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
