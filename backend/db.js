const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Tarif satırı: { name, amount, unit } (unit: 'ml' ya da 'g'). Sıra, bardağa ALTTAN ÜSTE ekleme sırasıdır.
const R = (name, amount, unit = 'ml') => ({ name, amount, unit });

// İlk kurulumda menü boşsa bu varsayılanlar eklenir; sonra barista panelinden değiştirilir.
// Tarifler standart (Küçük) boy içindir; diğer boyutlarda miktarlar boyutun hacim çarpanıyla ölçeklenir.
const DEFAULT_ITEMS = [
  { name: 'Türk Kahvesi', category: 'Kahve', price: 60, milk: 0, syrup: 0,
    description: 'Cezvede pişirilen, kalın telveli geleneksel Türk kahvesi.',
    recipe: [R('Su', 65), R('Türk kahvesi', 7, 'g')] },
  { name: 'Espresso', category: 'Kahve', price: 70, milk: 0, syrup: 1,
    description: 'Yoğun ve aromatik, tek shot saf espresso.',
    recipe: [R('Espresso', 30)] },
  { name: 'Doppio', category: 'Kahve', price: 85, milk: 0, syrup: 1,
    description: 'Çift shot espresso: daha yoğun ve güçlü.',
    recipe: [R('Espresso', 60)] },
  { name: 'Espresso Macchiato', category: 'Kahve', price: 85, milk: 1, syrup: 1,
    description: 'Espressonun üzerine bir kaşık süt köpüğü.',
    recipe: [R('Espresso', 30), R('Süt köpüğü', 15)] },
  { name: 'Americano', category: 'Kahve', price: 75, milk: 1, syrup: 1,
    description: 'Çift shot espressonun sıcak suyla yumuşatılmış hali.',
    recipe: [R('Espresso', 60), R('Sıcak su', 180)] },
  { name: 'Cortado', category: 'Kahve', price: 85, milk: 1, syrup: 1,
    description: 'Espresso ve eşit miktarda sıcak süt: yumuşak ama güçlü.',
    recipe: [R('Espresso', 60), R('Süt', 60)] },
  { name: 'Flat White', category: 'Kahve', price: 95, milk: 1, syrup: 1,
    description: 'Çift shot espresso ve ipeksi mikro köpüklü süt.',
    recipe: [R('Espresso', 60), R('Süt', 150), R('Süt köpüğü', 10)] },
  { name: 'Latte', category: 'Kahve', price: 90, milk: 1, syrup: 1,
    description: 'Yumuşak içimli: espresso, buharla ısıtılmış süt ve ince köpük.',
    recipe: [R('Espresso', 30), R('Süt', 180), R('Süt köpüğü', 30)] },
  { name: 'Cappuccino', category: 'Kahve', price: 90, milk: 1, syrup: 1,
    description: 'Eşit parça espresso, süt ve kalın, kadifemsi süt köpüğü.',
    recipe: [R('Espresso', 30), R('Süt', 90), R('Süt köpüğü', 90)] },
  { name: 'Latte Macchiato', category: 'Kahve', price: 95, milk: 1, syrup: 1,
    description: 'Önce süt, üstüne yavaşça espresso: katmanlı görünüm.',
    recipe: [R('Süt', 180), R('Espresso', 30), R('Süt köpüğü', 30)] },
  { name: 'Mocha', category: 'Kahve', price: 100, milk: 1, syrup: 1,
    description: 'Espresso, çikolata sosu ve sütün tatlı uyumu.',
    recipe: [R('Çikolata sosu', 25), R('Espresso', 30), R('Süt', 150), R('Süt köpüğü', 30)] },
  { name: 'Karamel Macchiato', category: 'Kahve', price: 105, milk: 1, syrup: 1,
    description: 'Süt, espresso ve üzerinde karamel sosu.',
    recipe: [R('Karamel sos', 15), R('Süt', 160), R('Espresso', 30), R('Süt köpüğü', 20)] },
  { name: 'Filtre Kahve', category: 'Kahve', price: 65, milk: 1, syrup: 1,
    description: 'Yavaş demlenmiş, hafif gövdeli günlük filtre kahve.',
    recipe: [R('Filtre kahve', 240)] },
  { name: 'Affogato', category: 'Kahve', price: 105, milk: 0, syrup: 1,
    description: 'Vanilyalı dondurmanın üzerine sıcak espresso.',
    recipe: [R('Vanilyalı dondurma', 80, 'g'), R('Espresso', 30)] },
  { name: 'Cold Brew', category: 'Soğuk Kahve', price: 90, milk: 0, syrup: 1,
    description: '12 saat soğuk demlenmiş, düşük asiditeli ferahlatıcı kahve.',
    recipe: [R('Buz', 90, 'g'), R('Cold brew kahve', 150)] },
  { name: 'Iced Latte', category: 'Soğuk Kahve', price: 95, milk: 1, syrup: 1,
    description: 'Buz üzerinde soğuk süt ve espresso.',
    recipe: [R('Buz', 100, 'g'), R('Süt', 150), R('Espresso', 30)] },
  { name: 'Çay', category: 'Diğer', price: 25, milk: 0, syrup: 0,
    description: 'Taze demlenmiş siyah çay.',
    recipe: [R('Demli çay', 100)] },
];

// [ad, ek ücret, hacim çarpanı]
const DEFAULT_SIZES = [['Küçük', 0, 1], ['Orta', 10, 1.25], ['Büyük', 20, 1.5]];
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

    -- description: kısa tanıtım metni; recipe: JSON [{ name, amount, unit }] (alttan üste)
    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE,
      category     TEXT NOT NULL DEFAULT 'Kahve',
      price        INTEGER NOT NULL,
      available    INTEGER NOT NULL DEFAULT 1,
      allow_milk   INTEGER NOT NULL DEFAULT 0,
      allow_syrup  INTEGER NOT NULL DEFAULT 0,
      description  TEXT NOT NULL DEFAULT '',
      recipe       TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- scale: tarifteki miktarların bu boyutta kaç katına çıkacağı (Küçük = 1)
    CREATE TABLE IF NOT EXISTS sizes (
      name       TEXT PRIMARY KEY,
      extra      INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      scale      REAL NOT NULL DEFAULT 1
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

  // Tarif özelliği sonradan eklenen menülerde: bilinen ürünlerin tarifini doldur ve yeni kahveleri ekle.
  // Yalnızca sütunlar ilk eklenirken çalışır; baristanın sonradan yaptığı değişiklikler ezilmez.
  const hadRecipes = menuColumns.includes('recipe');
  if (!menuColumns.includes('description')) db.exec("ALTER TABLE menu_items ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!hadRecipes) {
    db.exec("ALTER TABLE menu_items ADD COLUMN recipe TEXT NOT NULL DEFAULT '[]'");
    const fill = db.prepare("UPDATE menu_items SET description = ?, recipe = ? WHERE name = ? AND recipe = '[]'");
    const add = db.prepare(
      'INSERT OR IGNORE INTO menu_items (name, category, price, allow_milk, allow_syrup, description, recipe) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    DEFAULT_ITEMS.forEach((i) => {
      fill.run(i.description, JSON.stringify(i.recipe), i.name);
      add.run(i.name, i.category, i.price, i.milk, i.syrup, i.description, JSON.stringify(i.recipe));
    });
  }

  // Boyut hacim çarpanı sonradan eklenen menülerde bilinen boyutlara makul çarpan ver
  if (!columns('sizes').includes('scale')) {
    db.exec('ALTER TABLE sizes ADD COLUMN scale REAL NOT NULL DEFAULT 1');
    const set = db.prepare('UPDATE sizes SET scale = ? WHERE name = ?');
    DEFAULT_SIZES.forEach(([name, , scale]) => set.run(scale, name));
  }

  // Tek ürünlü eski siparişleri sepet yapısına çevir (ürün satırı olmayanlar için bir satır oluştur)
  db.exec(`
    INSERT INTO order_items (order_id, name, size, qty, unit_price)
    SELECT id, type, size, 1, price FROM orders
    WHERE id NOT IN (SELECT order_id FROM order_items) AND type != ''
  `);

  if (db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO menu_items (name, category, price, allow_milk, allow_syrup, description, recipe) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    DEFAULT_ITEMS.forEach((i) => ins.run(i.name, i.category, i.price, i.milk, i.syrup, i.description, JSON.stringify(i.recipe)));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM sizes').get().n === 0) {
    const ins = db.prepare('INSERT INTO sizes (name, extra, sort_order, scale) VALUES (?, ?, ?, ?)');
    DEFAULT_SIZES.forEach(([name, extra, scale], i) => ins.run(name, extra, i, scale));
  }
  for (const [table, defaults] of [['milks', DEFAULT_MILKS], ['syrups', DEFAULT_SYRUPS]]) {
    if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0) {
      const ins = db.prepare(`INSERT INTO ${table} (name, extra, available, sort_order) VALUES (?, ?, 1, ?)`);
      defaults.forEach(([name, extra], i) => ins.run(name, extra, i));
    }
  }
  return db;
}

function parseRecipe(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
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
    description: row.description || '',
    recipe: parseRecipe(row.recipe),
  };
}

module.exports = { openDb, toItem, DATA_DIR };
