const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// file olarak ':memory:' verilirse veritabanı sadece bellekte tutulur (testler için).
function openDb(file = process.env.DB_PATH || path.join(__dirname, 'orders.db')) {
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
  `);
  return db;
}

// Veritabanı satırını (snake_case) API formatına (camelCase) çevirir.
function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
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

module.exports = { openDb, toOrder };
