const { toItem } = require('./db');

const STATUSES = ['Bekliyor', 'Hazırlanıyor', 'Hazır', 'Teslim Edildi'];

const MAX_PRICE = 100000;
const MAX_SIZES = 6;

const isMoney = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_PRICE;
const cleanText = (v) => (typeof v === 'string' ? v.trim() : '');

// Menü ürünü doğrulama. partial=true ise sadece gelen alanlar kontrol edilir (PATCH).
function validateItem(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = cleanText(body.name);
    if (!name) errors.push('Ürün adı zorunludur.');
    else if (name.length > 40) errors.push('Ürün adı en fazla 40 karakter olabilir.');
    data.name = name;
  }
  if (!partial || body.category !== undefined) {
    const category = cleanText(body.category) || 'Kahve';
    if (category.length > 30) errors.push('Kategori en fazla 30 karakter olabilir.');
    data.category = category;
  }
  if (!partial || body.price !== undefined) {
    if (!isMoney(body.price)) errors.push(`Fiyat 0 ile ${MAX_PRICE} arasında bir tam sayı olmalıdır.`);
    data.price = body.price;
  }
  if (body.available !== undefined) {
    if (typeof body.available !== 'boolean') errors.push('"available" true veya false olmalıdır.');
    data.available = body.available ? 1 : 0;
  }
  return { errors, data };
}

function validateSizes(body) {
  const errors = [];
  const list = body && body.sizes;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SIZES) {
    return { errors: [`1 ile ${MAX_SIZES} arasında boyut olmalıdır.`], sizes: [] };
  }
  const seen = new Set();
  const sizes = list.map((s) => {
    const name = cleanText(s && s.name);
    if (!name || name.length > 20) errors.push('Boyut adı 1-20 karakter olmalıdır.');
    if (seen.has(name)) errors.push(`"${name}" boyutu birden fazla kez girilmiş.`);
    seen.add(name);
    if (!isMoney(s && s.extra)) errors.push('Boyut ek ücreti 0 ile 100000 arasında bir tam sayı olmalıdır.');
    return { name, extra: s && s.extra };
  });
  return { errors, sizes };
}

function createMenu(db) {
  const selectItems = db.prepare('SELECT * FROM menu_items ORDER BY id');
  const selectItemById = db.prepare('SELECT * FROM menu_items WHERE id = ?');
  const selectItemByName = db.prepare('SELECT * FROM menu_items WHERE name = ?');
  const insertItem = db.prepare('INSERT INTO menu_items (name, category, price) VALUES (?, ?, ?)');
  const deleteItem = db.prepare('DELETE FROM menu_items WHERE id = ?');
  const selectSizes = db.prepare('SELECT name, extra FROM sizes ORDER BY sort_order');
  const selectSizeByName = db.prepare('SELECT name, extra FROM sizes WHERE name = ?');
  const clearSizes = db.prepare('DELETE FROM sizes');
  const insertSize = db.prepare('INSERT INTO sizes (name, extra, sort_order) VALUES (?, ?, ?)');

  return {
    getMenu() {
      return {
        items: selectItems.all().map(toItem),
        sizes: selectSizes.all().map((s) => ({ name: s.name, extra: s.extra })),
        statuses: STATUSES,
      };
    },
    findItem: (name) => toItem(selectItemByName.get(name)),
    findItemById: (id) => toItem(selectItemById.get(id)),
    findSize(name) {
      const s = selectSizeByName.get(name);
      return s ? { name: s.name, extra: s.extra } : null;
    },
    createItem({ name, category, price }) {
      const { lastInsertRowid } = insertItem.run(name, category, price);
      return toItem(selectItemById.get(Number(lastInsertRowid)));
    },
    updateItem(id, data) {
      const allowed = ['name', 'category', 'price', 'available'];
      const keys = Object.keys(data).filter((k) => allowed.includes(k));
      if (!keys.length) return toItem(selectItemById.get(id));
      const sql = `UPDATE menu_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      const { changes } = db.prepare(sql).run(...keys.map((k) => data[k]), id);
      return changes ? toItem(selectItemById.get(id)) : null;
    },
    deleteItem: (id) => deleteItem.run(id).changes > 0,
    replaceSizes(sizes) {
      db.exec('BEGIN');
      try {
        clearSizes.run();
        sizes.forEach((s, i) => insertSize.run(s.name, s.extra, i));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

module.exports = { STATUSES, validateItem, validateSizes, createMenu };
