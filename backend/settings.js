// Kafe marka ayarları (ad, slogan, renk teması). Veritabanında anahtar-değer olarak saklanır.
const THEMES = ['kahve', 'zeytin', 'lacivert', 'bordo'];

const DEFAULT_SETTINGS = {
  cafeName: 'Kahve Sipariş',
  tagline: 'Taze kahve, hızlı sipariş',
  theme: 'kahve',
  tableCount: 10, // 0: masa/paket seçimi kapalı
};

const MAX_TABLES = 99;

function validateSettings(body) {
  const errors = [];
  const data = {};
  const b = body || {};

  if (b.cafeName !== undefined) {
    const v = typeof b.cafeName === 'string' ? b.cafeName.trim() : '';
    if (!v || v.length > 40) errors.push('Kafe adı 1-40 karakter olmalıdır.');
    data.cafeName = v;
  }
  if (b.tagline !== undefined) {
    const v = typeof b.tagline === 'string' ? b.tagline.trim() : '';
    if (v.length > 80) errors.push('Slogan en fazla 80 karakter olabilir.');
    data.tagline = v;
  }
  if (b.theme !== undefined) {
    if (!THEMES.includes(b.theme)) errors.push(`Tema şunlardan biri olmalı: ${THEMES.join(', ')}.`);
    data.theme = b.theme;
  }
  if (b.tableCount !== undefined) {
    if (!Number.isInteger(b.tableCount) || b.tableCount < 0 || b.tableCount > MAX_TABLES) {
      errors.push(`Masa sayısı 0 ile ${MAX_TABLES} arasında bir tam sayı olmalıdır.`);
    }
    data.tableCount = String(b.tableCount);
  }
  return { errors, data };
}

function createSettings(db) {
  const selectAll = db.prepare('SELECT key, value FROM settings');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  return {
    get() {
      const stored = Object.fromEntries(selectAll.all().map((r) => [r.key, r.value]));
      const merged = { ...DEFAULT_SETTINGS, ...stored };
      merged.tableCount = Number(merged.tableCount);
      return { ...merged, themes: THEMES };
    },
    update(data) {
      Object.entries(data).forEach(([k, v]) => upsert.run(k, v));
      return this.get();
    },
  };
}

module.exports = { THEMES, DEFAULT_SETTINGS, validateSettings, createSettings };
