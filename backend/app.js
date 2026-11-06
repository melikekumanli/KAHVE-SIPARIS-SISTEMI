const cors = require('cors');
const express = require('express');
const crypto = require('crypto');
const { STATUSES, validateItem, validateSizes, validateOptions, createMenu } = require('./menu');
const { validateOrder, validateRange, createOrders } = require('./orders');
const { createRateLimiter } = require('./rateLimiter');
const { validateSettings, createSettings } = require('./settings');

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
  const settings = createSettings(db);
  const orders = createOrders(db);
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

  // Süt ve şurup seçenekleri (ek ücret ve tükendi durumu). Gövde: { options: [{ name, extra, available }] }
  app.put('/api/menu/milks', requireAdmin, (req, res) => {
    const { errors, options } = validateOptions(req.body, 'Süt');
    if (errors.length) return res.status(400).json({ errors });
    menu.replaceMilks(options);
    res.json(menu.getMenu().milks);
  });

  app.put('/api/menu/syrups', requireAdmin, (req, res) => {
    const { errors, options } = validateOptions(req.body, 'Şurup');
    if (errors.length) return res.status(400).json({ errors });
    menu.replaceSyrups(options);
    res.json(menu.getMenu().syrups);
  });

  // ---------- Marka ayarları ----------

  // Kafe adı, slogan ve tema (herkese açık: müşteri sayfası da kullanır)
  app.get('/api/settings', (req, res) => res.json(settings.get()));

  app.put('/api/settings', requireAdmin, (req, res) => {
    const { errors, data } = validateSettings(req.body);
    if (errors.length) return res.status(400).json({ errors });
    res.json(settings.update(data));
  });

  // ---------- Siparişler ----------

  // Yeni sipariş (herkese açık). Gövde: { name, note, items: [{ type, size, qty }], service, table }
  app.post('/api/orders', (req, res) => {
    if (orderLimiter.blocked(req.ip)) {
      return res.status(429).json({ errors: ['Çok fazla sipariş gönderdiniz. Lütfen biraz bekleyin.'] });
    }

    const { errors, order } = validateOrder(req.body, { menu, tableCount: settings.get().tableCount });
    if (errors.length) return res.status(400).json({ errors });

    orderLimiter.hit(req.ip);
    res.status(201).json({ message: 'Sipariş başarıyla kaydedildi.', order: orders.create(order) });
  });

  // Tek siparişin durumu: id tahmin edilemez bir UUID olduğu için herkese açık.
  // Müşteri kendi siparişini bu uçtan takip eder.
  app.get('/api/orders/:id', (req, res) => {
    const order = orders.findById(req.params.id);
    if (!order) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.json(order);
  });

  // Siparişler (yönetici). İsteğe bağlı filtreler:
  //   ?scope=active  -> teslim edilmemiş siparişler (arşivdekiler hariç)
  //   ?status=Hazır  -> tek bir durum
  //   ?limit=100     -> en yeni N sipariş (en fazla 500)
  app.get('/api/orders', requireAdmin, (req, res) => {
    const { status, scope, limit } = req.query;
    const errors = [];
    if (status !== undefined && !STATUSES.includes(status)) errors.push('Geçersiz durum filtresi.');
    if (scope !== undefined && scope !== 'active') errors.push('Geçersiz kapsam filtresi.');
    if (limit !== undefined && !/^[0-9]+$/.test(String(limit))) errors.push('Geçersiz limit.');
    else if (limit !== undefined && (Number(limit) < 1 || Number(limit) > 500)) errors.push('Limit 1 ile 500 arasında olmalıdır.');
    if (errors.length) return res.status(400).json({ errors });

    res.json(orders.list({ status, scope, limit: limit === undefined ? undefined : Number(limit) }));
  });

  // Sipariş durumunu güncelleme (yönetici)
  app.patch('/api/orders/:id/status', requireAdmin, (req, res) => {
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ errors: [`Durum şunlardan biri olmalı: ${STATUSES.join(', ')}.`] });
    }
    const order = orders.setStatus(req.params.id, status);
    if (!order) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.json(order);
  });

  // Sipariş silme (yönetici)
  app.delete('/api/orders/:id', requireAdmin, (req, res) => {
    if (!orders.remove(req.params.id)) return res.status(404).json({ errors: ['Sipariş bulunamadı.'] });
    res.status(204).end();
  });

  // ---------- Raporlar (yönetici) ----------
  // ?from=<ISO tarih>&to=<ISO tarih> : from dahil, to hariç, en fazla 93 gün

  app.get('/api/reports', requireAdmin, (req, res) => {
    const { errors, from, to } = validateRange(req.query);
    if (errors.length) return res.status(400).json({ errors });
    res.json(orders.report(from, to));
  });

  app.get('/api/reports/orders.csv', requireAdmin, (req, res) => {
    const { errors, from, to } = validateRange(req.query);
    if (errors.length) return res.status(400).json({ errors });
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="siparisler-${from.toISOString().slice(0, 10)}.csv"`,
    });
    res.send(orders.toCsv(from, to));
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
