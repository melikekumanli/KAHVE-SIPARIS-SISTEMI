const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// İlk kurulumda menü boşsa bu varsayılanlar eklenir; sonra barista panelinden değiştirilir.
const DEFAULT_ITEMS = [
  ['Türk Kahvesi', 'Kahve', 60],
  ['Espresso', 'Kahve', 70],
  ['Americano', 'Kahve', 75],
  ['Latte', 'Kahve', 90],
  ['Cappuccino', 'Kahve', 90],
  ['Filtre Kahve', 'Kahve', 65],
  ['Çay', 'Diğer', 25],
];
const DEFAULT_SIZES = [['Küçük', 0], ['Orta', 10], ['Büyük', 20]];

// file olarak ':memory:' verilirse veritabanı sadece bellekte tutulur (testler için).
function openDb(file = process.env.DB_PATH || path.join(DATA_DIR, 'orders.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS orders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      size       TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      price      INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'Bekliyor',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS menu_items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      category  TEXT NOT NULL DEFAULT 'Kahve',
      price     INTEGER NOT NULL,
      available INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sizes (
      name       TEXT PRIMARY KEY,
      extra      INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);

  // Eski veritabanlarına sipariş numarası sütununu ekle
  const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderColumns.includes('number')) db.exec('ALTER TABLE orders ADD COLUMN number INTEGER');

  if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
    const ins = db.prepare('INSERT INTO menu_items (name, category, price) VALUES (?, ?, ?)');
    DEFAULT_ITEMS.forEach((item) => ins.run(...item));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM sizes').get().n === 0) {
    const ins = db.prepare('INSERT INTO sizes (name, extra, sort_order) VALUES (?, ?, ?)');
    DEFAULT_SIZES.forEach(([name, extra], i) => ins.run(name, extra, i));
  }
  return db;
}

// Veritabanı satırını (snake_case) API formatına (camelCase) çevirir.
function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.number ?? null,
    name: row.name,
    type: row.type,
    size: row.size,
    note: row.note,
    price: row.price,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    available: row.available === 1,
  };
}

module.exports = { openDb, toOrder, toItem, DATA_DIR };
