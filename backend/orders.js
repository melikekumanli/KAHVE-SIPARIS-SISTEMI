const crypto = require('crypto');
const { STATUSES } = require('./menu');

const MAX_LINES = 20;        // sepette en fazla farklı ürün satırı
const MAX_QTY = 20;          // bir satırdaki en fazla adet
const MAX_TOTAL_QTY = 50;    // siparişteki toplam adet
const MAX_SYRUPS = 3;        // bir içeceğe en fazla şurup
const MAX_REPORT_DAYS = 93;  // rapor aralığı sınırı

const pad = (n) => String(n).padStart(2, '0');
const localDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2× Latte (Büyük, Yulaf sütü, Vanilya + Karamel)" biçiminde satır özeti
function describeLine(l) {
  const extras = [l.milk, l.syrups && l.syrups.length ? l.syrups.join(' + ') : ''].filter(Boolean).join(', ');
  const inner = [l.size, extras].filter(Boolean).join(', ');
  return `${l.qty}× ${l.name} (${inner})`;
}

// ---------- Doğrulama ----------

// body: { name, note, items: [{ type, size, qty, milk?, syrups?: [] }], service: 'Masa'|'Paket', table }
function validateOrder(body, { menu, tableCount }) {
  const errors = new Set();
  const b = body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const note = typeof b.note === 'string' ? b.note.trim() : '';

  if (!name) errors.add('İsim zorunludur.');
  else if (name.length > 50) errors.add('İsim en fazla 50 karakter olabilir.');
  if (note.length > 200) errors.add('Not en fazla 200 karakter olabilir.');

  // Sepet satırları: aynı ürün, boyut ve seçenekler birleştirilir
  const merged = new Map();
  if (!Array.isArray(b.items) || b.items.length === 0) {
    errors.add('Sepet boş. En az bir ürün ekleyin.');
  } else if (b.items.length > MAX_LINES) {
    errors.add(`Bir siparişte en fazla ${MAX_LINES} farklı ürün olabilir.`);
  } else {
    for (const raw of b.items) {
      const line = raw && typeof raw === 'object' ? raw : {};
      let bad = false;
      const fail = (message) => { errors.add(message); bad = true; };

      const item = typeof line.type === 'string' ? menu.findItem(line.type) : null;
      const size = typeof line.size === 'string' ? menu.findSize(line.size) : null;
      const qty = line.qty === undefined ? 1 : line.qty;

      if (!item) fail('Sepette menüde olmayan bir ürün var.');
      else if (!item.available) fail(`${item.name} şu an mevcut değil (tükendi).`);
      if (!size) fail('Sepette geçersiz bir boyut var.');
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) fail(`Adet 1 ile ${MAX_QTY} arasında olmalıdır.`);

      // Süt: süt seçeneği olan ürünlerde seçilmediyse varsayılan süt kullanılır
      let milk = null;
      if (line.milk !== undefined && typeof line.milk !== 'string') fail('Geçersiz süt seçeneği.');
      else if (item) {
        const wanted = (line.milk || '').trim();
        if (item.allowsMilk) {
          if (!wanted && !menu.defaultMilk() && menu.milkCount() > 0) {
            // süt listesi dolu ama hiçbiri mevcut değil: sütlü içecek hazırlanamaz
            fail(`${item.name} için süt seçeneği şu an mevcut değil (tükendi).`);
          } else {
            milk = wanted ? menu.findMilk(wanted) : menu.defaultMilk();
            if (wanted && !milk) fail('Geçersiz süt seçeneği.');
            else if (milk && !milk.available) fail(`${milk.name} şu an mevcut değil (tükendi).`);
          }
        } else if (wanted) {
          fail(`${item.name} için süt seçeneği yok.`);
        }
      }

      // Şurup: isteğe bağlı, en fazla MAX_SYRUPS
      const syrups = [];
      const wantedSyrups = line.syrups === undefined ? [] : line.syrups;
      if (!Array.isArray(wantedSyrups) || wantedSyrups.some((s) => typeof s !== 'string')) {
        fail('Geçersiz şurup seçimi.');
      } else if (item) {
        const unique = [...new Set(wantedSyrups.map((s) => s.trim()).filter(Boolean))];
        if (unique.length && !item.allowsSyrup) fail(`${item.name} için şurup seçeneği yok.`);
        else if (unique.length > MAX_SYRUPS) fail(`En fazla ${MAX_SYRUPS} şurup seçilebilir.`);
        else {
          for (const syrupName of unique) {
            const syrup = menu.findSyrup(syrupName);
            if (!syrup) fail('Geçersiz şurup seçimi.');
            else if (!syrup.available) fail(`${syrup.name} şurubu şu an mevcut değil (tükendi).`);
            else syrups.push(syrup);
          }
        }
      }

      if (!bad) {
        const syrupNames = syrups.map((s) => s.name).sort((x, y) => x.localeCompare(y, 'tr'));
        const key = [item.name, size.name, milk ? milk.name : '', ...syrupNames].join('\u0000');
        const existing = merged.get(key);
        if (existing) existing.qty += qty;
        else {
          merged.set(key, {
            name: item.name,
            size: size.name,
            milk: milk ? milk.name : '',
            syrups: syrupNames,
            qty,
            unitPrice: item.price + size.extra + (milk ? milk.extra : 0) + syrups.reduce((sum, s) => sum + s.extra, 0),
          });
        }
      }
    }
  }
  const lines = [...merged.values()];
  if (lines.some((l) => l.qty > MAX_QTY)) errors.add(`Aynı ürün en fazla ${MAX_QTY} adet olabilir.`);
  if (lines.reduce((sum, l) => sum + l.qty, 0) > MAX_TOTAL_QTY) errors.add(`Bir siparişte en fazla ${MAX_TOTAL_QTY} ürün olabilir.`);

  // Servis türü ve masa
  let service = '';
  let tableNo = null;
  if (tableCount > 0) {
    if (b.service !== 'Masa' && b.service !== 'Paket') {
      errors.add('Servis türünü seçin (Masa veya Paket).');
    } else {
      service = b.service;
      if (service === 'Masa') {
        const t = b.table;
        if (!Number.isInteger(t) || t < 1 || t > tableCount) errors.add(`Masa numarası 1 ile ${tableCount} arasında olmalıdır.`);
        else tableNo = t;
      }
    }
  }

  return { errors: [...errors], order: { name, note, lines, service, tableNo } };
}

// Rapor aralığı: from (dahil) ve to (hariç), ISO tarih. En fazla 93 gün.
function validateRange(query) {
  const from = new Date(String(query.from));
  const to = new Date(String(query.to));
  if (query.from === undefined || query.to === undefined || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { errors: ['from ve to geçerli birer tarih olmalıdır.'] };
  }
  if (from >= to) return { errors: ['Başlangıç, bitişten önce olmalıdır.'] };
  if ((to - from) / 86_400_000 > MAX_REPORT_DAYS) return { errors: [`Rapor aralığı en fazla ${MAX_REPORT_DAYS} gün olabilir.`] };
  return { errors: [], from, to };
}

// ---------- Veritabanı işlemleri ----------

function createOrders(db) {
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, number, name, type, size, note, price, status, service, table_no, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?, 'Bekliyor', ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, name, size, milk, syrups, qty, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // Sipariş numarası her gün 1'den başlar (sunucunun yerel saatine göre)
  const nextNumber = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM orders WHERE created_at >= ?');
  const selectById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const updateStatus = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?');
  const deleteById = db.prepare('DELETE FROM orders WHERE id = ?');

  const parseSyrups = (text) => {
    try {
      const v = JSON.parse(text);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  // Sipariş satırlarına ürün satırlarını ekler (tek sorguyla, parçalar halinde)
  function toOrders(rows) {
    const itemsByOrder = new Map(rows.map((r) => [r.id, []]));
    for (let i = 0; i < rows.length; i += 500) {
      const ids = rows.slice(i, i + 500).map((r) => r.id);
      const items = db
        .prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
        .all(...ids);
      items.forEach((it) =>
        itemsByOrder.get(it.order_id).push({
          name: it.name,
          size: it.size,
          milk: it.milk,
          syrups: parseSyrups(it.syrups),
          qty: it.qty,
          unitPrice: it.unit_price,
          lineTotal: it.qty * it.unit_price,
        })
      );
    }
    return rows.map((r) => ({
      id: r.id,
      number: r.number ?? null,
      name: r.name,
      items: itemsByOrder.get(r.id),
      note: r.note,
      price: r.price,
      status: r.status,
      service: r.service,
      table: r.table_no ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  const findById = (id) => {
    const row = selectById.get(id);
    return row ? toOrders([row])[0] : null;
  };

  function create({ name, note, lines, service, tableNo }) {
    const id = crypto.randomUUID();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const total = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const summary = lines.map(describeLine).join(', ').slice(0, 200);

    db.exec('BEGIN');
    try {
      const number = nextNumber.get(dayStart.toISOString()).n;
      insertOrder.run(id, number, name, summary, note, total, service, tableNo, now.toISOString(), now.toISOString());
      lines.forEach((l) => insertItem.run(id, l.name, l.size, l.milk, JSON.stringify(l.syrups), l.qty, l.unitPrice));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return findById(id);
  }

  function list({ status, scope, limit } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (scope === 'active') { where.push('status != ?'); params.push('Teslim Edildi'); }
    let sql = 'SELECT * FROM orders';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC, rowid DESC';
    if (limit !== undefined) { sql += ' LIMIT ?'; params.push(limit); }
    return toOrders(db.prepare(sql).all(...params));
  }

  function setStatus(id, status) {
    const { changes } = updateStatus.run(status, new Date().toISOString(), id);
    return changes ? findById(id) : null;
  }

  const remove = (id) => deleteById.run(id).changes > 0;

  // Belirli bir aralıktaki (from dahil, to hariç) tüm siparişler
  function inRange(from, to) {
    const rows = db
      .prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at, rowid')
      .all(from.toISOString(), to.toISOString());
    return toOrders(rows);
  }

  // Rapor: toplamlar, günlük ciro, çok satanlar, saat dağılımı, süt/şurup tercihleri.
  // Günler/saatler sunucunun yerel saatine göredir.
  function report(from, to) {
    const orders = inRange(from, to);

    const days = new Map();
    for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      days.set(localDateKey(d), { date: localDateKey(d), orders: 0, revenue: 0 });
    }
    const byHour = Array(24).fill(0);
    const byService = { Masa: 0, Paket: 0, Diğer: 0 };
    const products = new Map();
    const milkCounts = new Map();
    const syrupCounts = new Map();
    let revenue = 0;
    let itemCount = 0;

    const bump = (map, key, qty) => map.set(key, (map.get(key) || 0) + qty);

    for (const o of orders) {
      const created = new Date(o.createdAt);
      const day = days.get(localDateKey(created));
      if (day) { day.orders += 1; day.revenue += o.price; }
      byHour[created.getHours()] += 1;
      byService[o.service === 'Masa' || o.service === 'Paket' ? o.service : 'Diğer'] += 1;
      revenue += o.price;
      for (const it of o.items) {
        itemCount += it.qty;
        const p = products.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
        p.qty += it.qty;
        p.revenue += it.lineTotal;
        products.set(it.name, p);
        if (it.milk) bump(milkCounts, it.milk, it.qty);
        it.syrups.forEach((s) => bump(syrupCounts, s, it.qty));
      }
    }

    const ranked = (map) => [...map.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'tr'));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        orders: orders.length,
        revenue,
        items: itemCount,
        average: orders.length ? Math.round(revenue / orders.length) : 0,
      },
      byDay: [...days.values()],
      topItems: [...products.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10),
      byHour,
      byService,
      milks: ranked(milkCounts),
      syrups: ranked(syrupCounts),
    };
  }

  // Excel (Türkçe) uyumlu CSV: ; ayırıcı, UTF-8 BOM. = + - @ ile başlayan hücreler formül sayılmasın diye ' ile başlatılır.
  function toCsv(from, to) {
    const cell = (v) => {
      let s = String(v ?? '').replace(/[\r\n]+/g, ' ');
      if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['Sipariş No', 'Tarih', 'Saat', 'Müşteri', 'Servis', 'Ürünler', 'Not', 'Tutar (TL)', 'Durum'];
    const rows = inRange(from, to).map((o) => {
      const d = new Date(o.createdAt);
      return [
        o.number ? `#${o.number}` : '',
        `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        o.name,
        o.service === 'Masa' ? `Masa ${o.table}` : o.service,
        o.items.map(describeLine).join(', '),
        o.note,
        o.price,
        o.status,
      ].map(cell).join(';');
    });
    return '﻿' + [header.map(cell).join(';'), ...rows].join('\r\n') + '\r\n';
  }

  return { create, findById, list, setStatus, remove, report, toCsv };
}

module.exports = { validateOrder, validateRange, createOrders, describeLine, STATUSES };
