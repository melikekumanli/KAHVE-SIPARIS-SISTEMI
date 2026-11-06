const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// İlk kurulumda menü boşsa bu varsayılanlar eklenir; sonra barista panelinden değiştirilir.
// [ad, kategori, fiyat, süt seçeneği var mı, şurup seçeneği var mı]
const DEFAULT_ITEMS = [
  ['Türk Kahvesi', 'Kahve', 60, 0, 0],
  ['Espresso', 'Kahve', 70, 0, 1],
  ['Americano', 'Kahve', 75, 1, 1],
  ['Latte', 'Kahve', 90, 1, 1],
  ['Cappuccino', 'Kahve', 90, 1, 1],
  ['Filtre Kahve', 'Kahve', 65, 1, 1],
  ['Çay', 'Diğer', 25, 0, 0],
];
const DEFAULT_SIZES = [['Küçük', 0], ['Orta', 10], ['Büyük', 20]];
const DEFAULT_MILKS = [['Normal süt', 0], ['Laktozsuz süt', 10], ['Badem sütü', 15], ['Yulaf sütü', 15], ['Soya sütü', 15]];
const DEFAULT_SYRUPS = [['Vanilya', 10], ['Karamel', 10], ['Fındık', 10], ['Çikolata', 10], ['Hindistan cevizi', 10]];

// Seçenek özelliğinden önce oluşturulmuş menülerde bu ürünler için süt/şurup otomatik açılır
const LEGACY_MILK_ITEMS = ['Americano', 'Latte', 'Cappuccino', 'Filtre Kahve', 'Mocha', 'Flat White'];
const LEGACY_SYRUP_ITEMS = ['Espresso', 'Americano', 'Latte', 'Cappuccino', 'Filtre Kahve', 'Mocha', 'Flat White'];

// file olarak ':memory:' verilirse veritabanı sadece bellekte tutulur (testler için).
function openDb(file = process.env.DB_PATH || path.join(DATA_DIR, 'orders.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    -- type ve size sütunları eski sürümlerden kalmadır (tek ürünlü sipariş).
    -- Yeni siparişlerde ürünler order_items tablosunda tutulur; type sadece özet metindir.
    CREATE TABLE IF NOT EXISTS orders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT '',
      size       TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      price      INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'Bekliyor',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

    -- Bir siparişin ürün satırları (sepet). Ad, seçenekler ve birim fiyat kopyası saklanır:
    -- menüyü değiştirmek eski siparişleri bozmaz. unit_price süt ve şurup ücretlerini de içerir.
    CREATE TABLE IF NOT EXISTS order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      size       TEXT NOT NULL,
      milk       TEXT NOT NULL DEFAULT '',
      syrups     TEXT NOT NULL DEFAULT '[]',
      qty        INTEGER NOT NULL,
      unit_price INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE,
      category     TEXT NOT NULL DEFAULT 'Kahve',
      price        INTEGER NOT NULL,
      available    INTEGER NOT NULL DEFAULT 1,
      allow_milk   INTEGER NOT NULL DEFAULT 0,
      allow_syrup  INTEGER NOT NULL DEFAULT 0
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

    -- Süt ve şurup seçenekleri: ek ücret ve "tükendi" durumu (available)
    CREATE TABLE IF NOT EXISTS milks (
      name       TEXT PRIMARY KEY,
      extra      INTEGER NOT NULL,
      available  INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS syrups (
      name       TEXT PRIMARY KEY,
      extra      INTEGER NOT NULL,
      available  INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL
    );
  `);

  // --- Eski veritabanlarını yükselt (migration) ---
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  const orderColumns = columns('orders');
  if (!orderColumns.includes('number')) db.exec('ALTER TABLE orders ADD COLUMN number INTEGER');
  if (!orderColumns.includes('service')) db.exec("ALTER TABLE orders ADD COLUMN service TEXT NOT NULL DEFAULT ''");
  if (!orderColumns.includes('table_no')) db.exec('ALTER TABLE orders ADD COLUMN table_no INTEGER');

  const itemColumns = columns('order_items');
  if (!itemColumns.includes('milk')) db.exec("ALTER TABLE order_items ADD COLUMN milk TEXT NOT NULL DEFAULT ''");
  if (!itemColumns.includes('syrups')) db.exec("ALTER TABLE order_items ADD COLUMN syrups TEXT NOT NULL DEFAULT '[]'");

  // Süt/şurup özelliği sonradan eklenen menülerde bilinen kahveler için seçenekleri aç
  const menuColumns = columns('menu_items');
  if (!menuColumns.includes('allow_milk')) {
    db.exec('ALTER TABLE menu_items ADD COLUMN allow_milk INTEGER NOT NULL DEFAULT 0');
    const set = db.prepare('UPDATE menu_items SET allow_milk = 1 WHERE name = ?');
    LEGACY_MILK_ITEMS.forEach((n) => set.run(n));
  }
  if (!menuColumns.includes('allow_syrup')) {
    db.exec('ALTER TABLE menu_items ADD COLUMN allow_syrup INTEGER NOT NULL DEFAULT 0');
    const set = db.prepare('UPDATE menu_items SET allow_syrup = 1 WHERE name = ?');
    LEGACY_SYRUP_ITEMS.forEach((n) => set.run(n));
  }

  // Tek ürünlü eski siparişleri sepet yapısına çevir (ürün satırı olmayanlar için bir satır oluştur)
  db.exec(`
    INSERT INTO order_items (order_id, name, size, qty, unit_price)
    SELECT id, type, size, 1, price FROM orders
    WHERE id NOT IN (SELECT order_id FROM order_items) AND type != ''
  `);

  if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
    const ins = db.prepare('INSERT INTO menu_items (name, category, price, allow_milk, allow_syrup) VALUES (?, ?, ?, ?, ?)');
    DEFAULT_ITEMS.forEach((item) => ins.run(...item));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM sizes').get().n === 0) {
    const ins = db.prepare('INSERT INTO sizes (name, extra, sort_order) VALUES (?, ?, ?)');
    DEFAULT_SIZES.forEach(([name, extra], i) => ins.run(name, extra, i));
  }
  for (const [table, defaults] of [['milks', DEFAULT_MILKS], ['syrups', DEFAULT_SYRUPS]]) {
    if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0) {
      const ins = db.prepare(`INSERT INTO ${table} (name, extra, available, sort_order) VALUES (?, ?, 1, ?)`);
      defaults.forEach(([name, extra], i) => ins.run(name, extra, i));
    }
  }
  return db;
}

function toItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    available: row.available === 1,
    allowsMilk: row.allow_milk === 1,
    allowsSyrup: row.allow_syrup === 1,
  };
}

module.exports = { openDb, toItem, DATA_DIR };
