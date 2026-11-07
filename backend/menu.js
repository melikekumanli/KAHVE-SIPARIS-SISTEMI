const { toItem } = require('./db');

const STATUSES = ['Bekliyor', 'Hazırlanıyor', 'Hazır', 'Teslim Edildi'];

const MAX_PRICE = 100000;
const MAX_SIZES = 6;
const MAX_OPTIONS = 12;      // süt ve şurup listelerinde en fazla seçenek
const MAX_RECIPE_LINES = 8;  // bir tarifteki en fazla içerik
const MAX_AMOUNT = 2000;     // bir içeriğin en fazla miktarı (ml ya da g)
const UNITS = ['ml', 'g'];

const isMoney = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_PRICE;
const cleanText = (v) => (typeof v === 'string' ? v.trim() : '');

// Tarif: [{ name, amount, unit }]. Boş liste kabul edilir (tarif yok).
function validateRecipe(list) {
  if (!Array.isArray(list) || list.length > MAX_RECIPE_LINES) {
    return { errors: [`Tarif en fazla ${MAX_RECIPE_LINES} içerik satırı içerebilir.`], recipe: [] };
  }
  const errors = new Set();
  const recipe = list.map((line) => {
    const l = line && typeof line === 'object' ? line : {};
    const name = cleanText(l.name);
    const unit = l.unit === undefined ? 'ml' : l.unit;
    if (!name || name.length > 30) errors.add('İçerik adı 1-30 karakter olmalıdır.');
    if (!UNITS.includes(unit)) errors.add(`Birim ${UNITS.join(' ya da ')} olmalıdır.`);
    if (!Number.isInteger(l.amount) || l.amount < 1 || l.amount > MAX_AMOUNT) {
      errors.add(`Miktar 1 ile ${MAX_AMOUNT} arasında bir tam sayı olmalıdır.`);
    }
    return { name, amount: l.amount, unit };
  });
  return { errors: [...errors], recipe };
}

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
  for (const [field, column, label] of [
    ['available', 'available', '"available"'],
    ['allowsMilk', 'allow_milk', '"allowsMilk"'],
    ['allowsSyrup', 'allow_syrup', '"allowsSyrup"'],
  ]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') errors.push(`${label} true veya false olmalıdır.`);
      data[column] = body[field] ? 1 : 0;
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') errors.push('Açıklama metin olmalıdır.');
    else if (body.description.trim().length > 160) errors.push('Açıklama en fazla 160 karakter olabilir.');
    data.description = cleanText(body.description);
  }
  if (body.recipe !== undefined) {
    const result = validateRecipe(body.recipe);
    errors.push(...result.errors);
    data.recipe = JSON.stringify(result.recipe);
  }
  return { errors, data };
}

// Boyutlar: { sizes: [{ name, extra, scale? }] }. scale (hacim çarpanı) varsayılan 1, 0.5 ile 3 arası.
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
    const scale = s && s.scale === undefined ? 1 : s && s.scale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0.5 || scale > 3) {
      errors.push('Hacim çarpanı 0.5 ile 3 arasında bir sayı olmalıdır.');
    }
    return { name, extra: s && s.extra, scale: typeof scale === 'number' ? Math.round(scale * 100) / 100 : 1 };
  });
  return { errors: [...new Set(errors)], sizes };
}

// Süt / şurup listesi: { options: [{ name, extra, available }] }. Boş liste kabul edilir (seçenek kapatılır).
function validateOptions(body, label) {
  const list = body && body.options;
  if (!Array.isArray(list) || list.length > MAX_OPTIONS) {
    return { errors: [`${label} listesi en fazla ${MAX_OPTIONS} seçenek içerebilir.`], options: [] };
  }
  const errors = [];
  const seen = new Set();
  const options = list.map((o) => {
    const name = cleanText(o && o.name);
    if (!name || name.length > 30) errors.push(`${label} adı 1-30 karakter olmalıdır.`);
    if (seen.has(name)) errors.push(`"${name}" birden fazla kez girilmiş.`);
    seen.add(name);
    if (!isMoney(o && o.extra)) errors.push(`${label} ek ücreti 0 ile ${MAX_PRICE} arasında bir tam sayı olmalıdır.`);
    if (o && o.available !== undefined && typeof o.available !== 'boolean') errors.push('"available" true veya false olmalıdır.');
    return { name, extra: o && o.extra, available: !o || o.available !== false };
  });
  return { errors: [...new Set(errors)], options };
}

const OPTION_TABLES = new Set(['milks', 'syrups']);

function createMenu(db) {
  const selectItems = db.prepare('SELECT * FROM menu_items ORDER BY id');
  const selectItemById = db.prepare('SELECT * FROM menu_items WHERE id = ?');
  const selectItemByName = db.prepare('SELECT * FROM menu_items WHERE name = ?');
  const insertItem = db.prepare(
    'INSERT INTO menu_items (name, category, price, allow_milk, allow_syrup, description, recipe) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const deleteItem = db.prepare('DELETE FROM menu_items WHERE id = ?');
  const selectSizes = db.prepare('SELECT name, extra, scale FROM sizes ORDER BY sort_order');
  const selectSizeByName = db.prepare('SELECT name, extra, scale FROM sizes WHERE name = ?');
  const clearSizes = db.prepare('DELETE FROM sizes');
  const insertSize = db.prepare('INSERT INTO sizes (name, extra, sort_order, scale) VALUES (?, ?, ?, ?)');

  // Süt ve şurup tabloları aynı yapıdadır; tablo adı sabit bir listeden gelir (SQL'e kullanıcı verisi girmez)
  const optionApi = (table) => {
    if (!OPTION_TABLES.has(table)) throw new Error('Geçersiz tablo');
    const selectAll = db.prepare(`SELECT name, extra, available FROM ${table} ORDER BY sort_order`);
    const selectByName = db.prepare(`SELECT name, extra, available FROM ${table} WHERE name = ?`);
    const clear = db.prepare(`DELETE FROM ${table}`);
    const insert = db.prepare(`INSERT INTO ${table} (name, extra, available, sort_order) VALUES (?, ?, ?, ?)`);
    const map = (r) => (r ? { name: r.name, extra: r.extra, available: r.available === 1 } : null);
    return {
      all: () => selectAll.all().map(map),
      find: (name) => map(selectByName.get(name)),
      replace(list) {
        db.exec('BEGIN');
        try {
          clear.run();
          list.forEach((o, i) => insert.run(o.name, o.extra, o.available ? 1 : 0, i));
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      },
    };
  };
  const milks = optionApi('milks');
  const syrups = optionApi('syrups');

  const mapSize = (s) => (s ? { name: s.name, extra: s.extra, scale: s.scale } : null);

  return {
    getMenu() {
      return {
        items: selectItems.all().map(toItem),
        sizes: selectSizes.all().map(mapSize),
        milks: milks.all(),
        syrups: syrups.all(),
        statuses: STATUSES,
      };
    },
    findItem: (name) => toItem(selectItemByName.get(name)),
    findItemById: (id) => toItem(selectItemById.get(id)),
    findSize: (name) => mapSize(selectSizeByName.get(name)),
    findMilk: milks.find,
    findSyrup: syrups.find,
    // Süt seçilmediyse kullanılan varsayılan: listedeki ilk "mevcut" süt
    defaultMilk: () => milks.all().find((m) => m.available) || null,
    milkCount: () => milks.all().length,
    createItem({ name, category, price, allow_milk = 0, allow_syrup = 0, description = '', recipe = '[]' }) {
      const { lastInsertRowid } = insertItem.run(name, category, price, allow_milk, allow_syrup, description, recipe);
      return toItem(selectItemById.get(Number(lastInsertRowid)));
    },
    updateItem(id, data) {
      const allowed = ['name', 'category', 'price', 'available', 'allow_milk', 'allow_syrup', 'description', 'recipe'];
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
        sizes.forEach((s, i) => insertSize.run(s.name, s.extra, i, s.scale));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    replaceMilks: milks.replace,
    replaceSyrups: syrups.replace,
  };
}

module.exports = { STATUSES, validateItem, validateSizes, validateOptions, validateRecipe, createMenu };
