const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('./db');
const { createApp } = require('./app');

const ADMIN = { 'x-admin-token': 'test-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const line = (type, size = 'Orta', qty = 1) => ({ type, size, qty });
// Varsayılan geçerli sipariş: 3 numaralı masada 1 Latte (Orta) = 90 + 10 = 100 ₺
const validOrder = { name: 'Ayşe', note: 'şekersiz', items: [line('Latte')], service: 'Masa', table: 3 };

function startServer(options = {}) {
  const db = openDb(':memory:');
  const app = createApp(db, {
    adminToken: 'test-token',
    orderLimit: { windowMs: 60_000, max: 1000 },
    loginLimit: { windowMs: 60_000, max: 1000 }, // testler art arda 401 üretir; sınır ayrı testte denenir
    ...options,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ db, server, base: `http://localhost:${server.address().port}` }));
  });
}
const stop = (server) => new Promise((resolve) => server.close(resolve));

let db, server, base;

before(async () => {
  ({ db, server, base } = await startServer({
    allowedOrigins: ['http://localhost:5500'],
    staticDir: path.join(__dirname, '..', 'frontend'),
  }));
});
after(() => stop(server));

// Her testte siparişler temizlenir; menü, boyutlar ve ayarlar varsayılana döner
beforeEach(() => {
  db.exec('DELETE FROM orders; DELETE FROM order_items; DELETE FROM menu_items; DELETE FROM sizes; DELETE FROM settings;');
  db.exec(`INSERT INTO menu_items (name, category, price) VALUES
    ('Türk Kahvesi','Kahve',60), ('Latte','Kahve',90), ('Çay','Diğer',25);
    INSERT INTO sizes (name, extra, sort_order) VALUES ('Küçük',0,0), ('Orta',10,1), ('Büyük',20,2);`);
});

const post = (body) =>
  fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
const adminFetch = (url, method = 'GET', body) =>
  fetch(`${base}${url}`, { method, headers: { ...JSON_HEADERS, ...ADMIN }, body: body ? JSON.stringify(body) : undefined });
const placed = async (body = validOrder) => (await (await post(body)).json()).order;
const menuOf = async () => (await fetch(`${base}/api/menu`)).json();

// ---------- Menü ----------

test('menü ürünler, boyutlar ve durumlarla birlikte döner', async () => {
  const menu = await menuOf();
  assert.deepEqual(menu.items.map((i) => i.name), ['Türk Kahvesi', 'Latte', 'Çay']);
  assert.equal(menu.items[0].available, true);
  assert.deepEqual(menu.sizes.map((s) => s.name), ['Küçük', 'Orta', 'Büyük']);
  assert.ok(menu.statuses.includes('Bekliyor'));
});

test('yönetici ürün ekler; müşteri hemen sipariş verebilir', async () => {
  const res = await adminFetch('/api/menu/items', 'POST', { name: 'Mocha', category: 'Kahve', price: 95 });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).available, true);

  const order = await post({ ...validOrder, items: [line('Mocha', 'Küçük')] });
  assert.equal(order.status, 201);
  assert.equal((await order.json()).order.price, 95);
});

test('ürün eklerken doğrulama: boş ad, kötü fiyat 400; aynı ad 409', async () => {
  const bad = [
    { name: '', price: 10 },
    { name: 'a'.repeat(41), price: 10 },
    { name: 'X', price: -5 },
    { name: 'X', price: 10.5 },
    { name: 'X', price: '10' },
    { name: 'X' },
  ];
  for (const body of bad) assert.equal((await adminFetch('/api/menu/items', 'POST', body)).status, 400, JSON.stringify(body));
  assert.equal((await adminFetch('/api/menu/items', 'POST', { name: 'Latte', price: 10 })).status, 409);
});

test('fiyat güncellenince yeni sipariş yeni fiyatla, eski sipariş eski fiyatla kalır', async () => {
  const first = await placed(); // Latte 90 + Orta 10
  const latte = (await menuOf()).items.find((i) => i.name === 'Latte');

  const res = await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { price: 100 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).price, 100);

  assert.equal((await placed()).price, 110);
  const stored = await (await fetch(`${base}/api/orders/${first.id}`)).json();
  assert.equal(stored.price, 100);
  assert.equal(stored.items[0].unitPrice, 100);
});

test('tükendi işaretlenen ürün sipariş edilemez, tekrar açılınca edilir', async () => {
  const latte = (await menuOf()).items.find((i) => i.name === 'Latte');
  await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { available: false });

  const blocked = await post(validOrder);
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).errors[0], /tükendi/);

  await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { available: true });
  assert.equal((await post(validOrder)).status, 201);
});

test('ürün güncelleme: olmayan ürün 404, çakışan ad 409, geçersiz alan 400', async () => {
  const items = (await menuOf()).items;
  assert.equal((await adminFetch('/api/menu/items/99999', 'PATCH', { price: 5 })).status, 404);
  assert.equal((await adminFetch('/api/menu/items/abc', 'PATCH', { price: 5 })).status, 404);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { name: 'Latte' })).status, 409);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { available: 'evet' })).status, 400);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { price: -1 })).status, 400);
});

test('ürün silinince menüden kalkar ama eski siparişi bozulmaz', async () => {
  const order = await placed();
  const latte = (await menuOf()).items.find((i) => i.name === 'Latte');

  assert.equal((await adminFetch(`/api/menu/items/${latte.id}`, 'DELETE')).status, 204);
  assert.equal((await adminFetch(`/api/menu/items/${latte.id}`, 'DELETE')).status, 404);
  assert.equal((await post(validOrder)).status, 400);

  const stored = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.equal(stored.items[0].name, 'Latte');
  assert.equal(stored.price, 100);
});

test('boyutlar topluca güncellenir ve doğrulanır', async () => {
  const ok = await adminFetch('/api/menu/sizes', 'PUT', { sizes: [{ name: 'Tek', extra: 0 }, { name: 'Çift', extra: 15 }] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await menuOf()).sizes, [{ name: 'Tek', extra: 0 }, { name: 'Çift', extra: 15 }]);

  assert.equal((await post({ ...validOrder, items: [line('Latte', 'Orta')] })).status, 400);
  assert.equal((await post({ ...validOrder, items: [line('Latte', 'Çift')] })).status, 201);

  const bad = [
    { sizes: [] },
    { sizes: [{ name: '', extra: 0 }] },
    { sizes: [{ name: 'A', extra: -1 }] },
    { sizes: [{ name: 'A', extra: 0 }, { name: 'A', extra: 5 }] },
    { sizes: Array.from({ length: 7 }, (_, i) => ({ name: 'B' + i, extra: 0 })) },
    {},
  ];
  for (const body of bad) assert.equal((await adminFetch('/api/menu/sizes', 'PUT', body)).status, 400, JSON.stringify(body).slice(0, 50));
  assert.equal((await menuOf()).sizes.length, 2);
});

test('menü yönetim uçları anahtarsız 401 döner', async () => {
  const calls = [
    fetch(`${base}/api/menu/items`, { method: 'POST', headers: JSON_HEADERS, body: '{"name":"X","price":1}' }),
    fetch(`${base}/api/menu/items/1`, { method: 'PATCH', headers: JSON_HEADERS, body: '{"price":1}' }),
    fetch(`${base}/api/menu/items/1`, { method: 'DELETE' }),
    fetch(`${base}/api/menu/sizes`, { method: 'PUT', headers: JSON_HEADERS, body: '{"sizes":[]}' }),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
});

// ---------- Sepet: siparişler ----------

test('geçerli sipariş kaydedilir, fiyat sunucuda hesaplanır', async () => {
  const res = await post(validOrder);
  assert.equal(res.status, 201);
  const { order } = await res.json();
  assert.equal(order.name, 'Ayşe');
  assert.equal(order.price, 100); // Latte 90 + Orta 10
  assert.equal(order.status, 'Bekliyor');
  assert.equal(order.service, 'Masa');
  assert.equal(order.table, 3);
  assert.deepEqual(order.items, [{ name: 'Latte', size: 'Orta', qty: 1, unitPrice: 100, lineTotal: 100 }]);
  assert.match(order.id, /^[0-9a-f-]{36}$/);
});

test('sepette birden çok ürün ve adet: toplam doğru hesaplanır', async () => {
  const order = await placed({ ...validOrder, items: [line('Latte', 'Orta', 2), line('Çay', 'Küçük', 1)] });
  assert.equal(order.price, 225); // 2×100 + 25
  assert.equal(order.items.length, 2);
  assert.deepEqual(order.items.map((i) => i.qty), [2, 1]);
});

test('aynı ürün ve boyut satırları birleştirilir', async () => {
  const order = await placed({ ...validOrder, items: [line('Latte', 'Orta', 1), line('Latte', 'Orta', 2), line('Latte', 'Büyük', 1)] });
  assert.equal(order.items.length, 2);
  assert.equal(order.items.find((i) => i.size === 'Orta').qty, 3);
  assert.equal(order.price, 3 * 100 + 110);
});

test('adet belirtilmezse 1 sayılır', async () => {
  const order = await placed({ ...validOrder, items: [{ type: 'Çay', size: 'Küçük' }] });
  assert.equal(order.items[0].qty, 1);
});

test('istemcinin gönderdiği fiyat ve durum yok sayılır', async () => {
  const order = await placed({ ...validOrder, price: 1, status: 'Teslim Edildi', items: [{ ...line('Latte'), unitPrice: 1 }] });
  assert.equal(order.price, 100);
  assert.equal(order.status, 'Bekliyor');
});

test('isim kenarlardaki boşluklardan arındırılır', async () => {
  assert.equal((await placed({ ...validOrder, name: '  Ayşe  ' })).name, 'Ayşe');
});

test('geçersiz sipariş girdileri 400 döner', async () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ ...line('Latte'), size: ['Küçük', 'Orta', 'Büyük'][i % 3] }));
  const cases = {
    'isim boş': { ...validOrder, name: '' },
    'isim uzun': { ...validOrder, name: 'a'.repeat(51) },
    'not uzun': { ...validOrder, note: 'x'.repeat(201) },
    'sepet yok': { name: 'A', service: 'Paket' },
    'sepet boş': { ...validOrder, items: [] },
    'sepet dizi değil': { ...validOrder, items: 'Latte' },
    'bilinmeyen ürün': { ...validOrder, items: [line('Pizza')] },
    'ürün sayı': { ...validOrder, items: [{ type: 123, size: 'Orta', qty: 1 }] },
    'geçersiz boyut': { ...validOrder, items: [line('Latte', 'XL')] },
    'adet 0': { ...validOrder, items: [line('Latte', 'Orta', 0)] },
    'adet 21': { ...validOrder, items: [line('Latte', 'Orta', 21)] },
    'adet ondalık': { ...validOrder, items: [line('Latte', 'Orta', 1.5)] },
    'adet metin': { ...validOrder, items: [line('Latte', 'Orta', '2')] },
    'birleşince 20 üstü': { ...validOrder, items: [line('Latte', 'Orta', 15), line('Latte', 'Orta', 10)] },
    'toplam 50 üstü': { ...validOrder, items: [line('Latte', 'Orta', 20), line('Latte', 'Küçük', 20), line('Latte', 'Büyük', 15)] },
    'çok satır': { ...validOrder, items: many },
    'satır nesne değil': { ...validOrder, items: [null] },
    'servis yok': { ...validOrder, service: undefined },
    'servis geçersiz': { ...validOrder, service: 'Teras' },
    'masa 0': { ...validOrder, table: 0 },
    'masa aralık dışı': { ...validOrder, table: 11 },
    'masa metin': { ...validOrder, table: 'a' },
    'masa yok': { ...validOrder, table: undefined },
    'boş gövde': {},
  };
  for (const [label, body] of Object.entries(cases)) {
    const res = await post(body);
    assert.equal(res.status, 400, label);
    assert.ok(Array.isArray((await res.json()).errors), label);
  }
  // hatalı istekler hiçbir şey kaydetmez
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n, 0);
});

test('paket siparişinde masa numarası gerekmez ve yok sayılır', async () => {
  const order = await placed({ ...validOrder, service: 'Paket', table: 7 });
  assert.equal(order.service, 'Paket');
  assert.equal(order.table, null);
});

test('masa sayısı 0 yapılırsa servis seçimi kapanır; ayar doğrulanır', async () => {
  for (const bad of [-1, 100, 1.5, '5', null]) {
    assert.equal((await adminFetch('/api/settings', 'PUT', { tableCount: bad })).status, 400, String(bad));
  }
  assert.equal((await adminFetch('/api/settings', 'PUT', { tableCount: 0 })).status, 200);
  const order = await placed({ name: 'Ayşe', items: [line('Latte')] });
  assert.equal(order.service, '');
  assert.equal(order.table, null);

  // masa sayısı düşürülünce eski numara geçersiz olur
  await adminFetch('/api/settings', 'PUT', { tableCount: 5 });
  assert.equal((await post({ ...validOrder, table: 6 })).status, 400);
  assert.equal((await post({ ...validOrder, table: 5 })).status, 201);
});

test('SQL enjeksiyon denemesi zararsızdır', async () => {
  const res = await post({ ...validOrder, name: "x'); DROP TABLE orders;--" });
  assert.equal(res.status, 201);
  assert.equal((await (await adminFetch('/api/orders')).json()).length, 1);
});

test('bozuk JSON 400 döner', async () => {
  const res = await fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: '{bozuk' });
  assert.equal(res.status, 400);
});

test('eşzamanlı 20 sipariş kaybolmadan ve benzersiz numarayla kaydedilir', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ ...validOrder, name: `k${i}` })));
  assert.ok(results.every((r) => r.status === 201));
  const all = await (await adminFetch('/api/orders')).json();
  assert.equal(all.length, 20);
  assert.equal(new Set(all.map((o) => o.number)).size, 20);
  assert.ok(all.every((o) => o.items.length === 1));
});

test('sipariş numarası birden başlayıp birer artar', async () => {
  const numbers = [];
  for (let i = 0; i < 3; i++) numbers.push((await placed()).number);
  assert.deepEqual(numbers, [1, 2, 3]);
});

test('müşteri kendi siparişini (ürünleriyle) id ile görebilir, olmayan id 404', async () => {
  const order = await placed({ ...validOrder, items: [line('Latte', 'Orta', 2), line('Çay', 'Küçük')] });
  const res = await fetch(`${base}/api/orders/${order.id}`);
  assert.equal(res.status, 200);
  const seen = await res.json();
  assert.equal(seen.id, order.id);
  assert.equal(seen.items.length, 2);
  assert.equal((await fetch(`${base}/api/orders/yok`)).status, 404);
});

test('sipariş yönetim uçları anahtar olmadan veya yanlış anahtarla 401 döner', async () => {
  const order = await placed();
  const wrong = { 'x-admin-token': 'yanlis' };
  const calls = [
    fetch(`${base}/api/orders`),
    fetch(`${base}/api/orders`, { headers: wrong }),
    fetch(`${base}/api/orders/${order.id}/status`, { method: 'PATCH', headers: { ...JSON_HEADERS, ...wrong }, body: '{"status":"Hazır"}' }),
    fetch(`${base}/api/orders/${order.id}`, { method: 'DELETE' }),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
});

test('yönetici durumu günceller; geçersiz durum 400, olmayan sipariş 404', async () => {
  const order = await placed();
  const ok = await adminFetch(`/api/orders/${order.id}/status`, 'PATCH', { status: 'Hazırlanıyor' });
  assert.equal(ok.status, 200);
  const updated = await ok.json();
  assert.equal(updated.status, 'Hazırlanıyor');
  assert.equal(updated.items.length, 1);
  assert.equal((await (await fetch(`${base}/api/orders/${order.id}`)).json()).status, 'Hazırlanıyor');
  assert.equal((await adminFetch(`/api/orders/${order.id}/status`, 'PATCH', { status: 'Uçtu' })).status, 400);
  assert.equal((await adminFetch('/api/orders/yok/status', 'PATCH', { status: 'Hazır' })).status, 404);
});

test('scope=active arşivi hariç tutar; status ve limit filtreleri çalışır', async () => {
  const ids = [];
  for (const name of ['a', 'b', 'c', 'd']) ids.push((await placed({ ...validOrder, name })).id);
  await adminFetch(`/api/orders/${ids[0]}/status`, 'PATCH', { status: 'Teslim Edildi' });
  await adminFetch(`/api/orders/${ids[1]}/status`, 'PATCH', { status: 'Teslim Edildi' });

  const get = async (q) => (await (await adminFetch(`/api/orders${q}`)).json()).map((o) => o.name);
  assert.deepEqual(await get('?scope=active'), ['d', 'c']);
  assert.deepEqual(await get('?status=Teslim%20Edildi'), ['b', 'a']);
  assert.deepEqual(await get('?limit=3'), ['d', 'c', 'b']);
  assert.deepEqual(await get('?status=Teslim%20Edildi&limit=1'), ['b']);

  for (const q of ['?limit=0', '?limit=501', '?limit=abc', '?limit=-1', '?scope=hepsi', '?status=x']) {
    assert.equal((await adminFetch(`/api/orders${q}`)).status, 400, q);
  }
});

test('yönetici siparişi siler; ürün satırları da silinir', async () => {
  const order = await placed({ ...validOrder, items: [line('Latte'), line('Çay', 'Küçük', 3)] });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n, 2);
  assert.equal((await adminFetch(`/api/orders/${order.id}`, 'DELETE')).status, 204);
  assert.equal((await fetch(`${base}/api/orders/${order.id}`)).status, 404);
  assert.equal((await adminFetch(`/api/orders/${order.id}`, 'DELETE')).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n, 0);
});

// ---------- Marka ayarları ----------

test('ayarlar: varsayılanlar herkese açık, güncelleme sadece yöneticiye', async () => {
  const s = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(s.cafeName, 'Kahve Sipariş');
  assert.equal(s.theme, 'kahve');
  assert.equal(s.tableCount, 10);
  assert.ok(s.themes.includes('zeytin'));

  const put = (body, headers = ADMIN) =>
    fetch(`${base}/api/settings`, { method: 'PUT', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });

  assert.equal((await put({ cafeName: 'X' }, {})).status, 401);

  assert.equal((await put({ cafeName: '  Moka Kafe  ', tagline: 'Her gün taze', theme: 'zeytin', tableCount: 12 })).status, 200);
  const saved = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(saved.cafeName, 'Moka Kafe');
  assert.equal(saved.tagline, 'Her gün taze');
  assert.equal(saved.theme, 'zeytin');
  assert.equal(saved.tableCount, 12);

  await put({ theme: 'bordo' });
  const partial = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(partial.cafeName, 'Moka Kafe');
  assert.equal(partial.tableCount, 12);
  assert.equal(partial.theme, 'bordo');

  for (const bad of [{ cafeName: '' }, { cafeName: 'x'.repeat(41) }, { tagline: 'x'.repeat(81) }, { theme: 'pembe' }, { cafeName: 5 }]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  }
});

// ---------- Raporlar ----------

const todayRange = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
};

test('rapor: toplamlar, çok satanlar, saat dağılımı ve servis türleri doğru', async () => {
  await placed({ ...validOrder, items: [line('Latte', 'Orta', 2), line('Çay', 'Küçük')] });          // 225, Masa
  await placed({ ...validOrder, service: 'Paket', items: [line('Türk Kahvesi', 'Küçük')] });          // 60, Paket
  await placed({ ...validOrder, items: [line('Latte', 'Küçük')] });                                   // 90, Masa

  const res = await adminFetch(`/api/reports?${todayRange()}`);
  assert.equal(res.status, 200);
  const r = await res.json();

  assert.deepEqual(r.totals, { orders: 3, revenue: 375, items: 5, average: 125 });
  assert.equal(r.byDay.length, 1);
  assert.deepEqual([r.byDay[0].orders, r.byDay[0].revenue], [3, 375]);
  assert.deepEqual(r.topItems.map((t) => [t.name, t.qty, t.revenue]), [['Latte', 3, 290], ['Türk Kahvesi', 1, 60], ['Çay', 1, 25]]);
  assert.equal(r.byHour.length, 24);
  assert.equal(r.byHour.reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(r.byService, { Masa: 2, Paket: 1, Diğer: 0 });
});

test('rapor: boş aralık sıfır döner, çok günlü aralıkta eksik günler doldurulur', async () => {
  const empty = await (await adminFetch(`/api/reports?${todayRange()}`)).json();
  assert.deepEqual(empty.totals, { orders: 0, revenue: 0, items: 0, average: 0 });

  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
  const to = new Date(); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
  await placed();
  const week = await (await adminFetch(`/api/reports?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)).json();
  assert.equal(week.byDay.length, 7);
  assert.equal(week.byDay.at(-1).orders, 1);
  assert.equal(week.byDay.slice(0, 6).every((d) => d.orders === 0), true);
});

test('rapor: geçersiz aralık 400, anahtarsız 401', async () => {
  const now = new Date();
  const iso = (d) => encodeURIComponent(d.toISOString());
  const later = new Date(now.getTime() + 3600_000);
  const farFuture = new Date(now.getTime() + 94 * 86_400_000);
  const bad = ['', '?from=x&to=y', `?from=${iso(now)}`, `?from=${iso(later)}&to=${iso(now)}`, `?from=${iso(now)}&to=${iso(now)}`, `?from=${iso(now)}&to=${iso(farFuture)}`];
  for (const q of bad) assert.equal((await adminFetch(`/api/reports${q}`)).status, 400, q);
  assert.equal((await fetch(`${base}/api/reports?${todayRange()}`)).status, 401);
  assert.equal((await fetch(`${base}/api/reports/orders.csv?${todayRange()}`)).status, 401);
});

test('CSV dışa aktarma: başlıklar, Excel uyumu, formül enjeksiyonu ve tırnak kaçışı', async () => {
  await placed({ ...validOrder, name: 'Ali "Usta"', note: '=1+1', items: [line('Latte', 'Orta', 2), line('Çay', 'Küçük')] });
  await placed({ ...validOrder, name: 'Veli', service: 'Paket', note: 'satır\nsonu', items: [line('Çay', 'Küçük')] });

  const res = await adminFetch(`/api/reports/orders.csv?${todayRange()}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="siparisler-\d{4}-\d{2}-\d{2}\.csv"/);

  // Excel için UTF-8 BOM: fetch().text() BOM'u siler, bu yüzden ham baytlara bakılır
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = bytes.subarray(3).toString('utf8').trim().split('\r\n');
  assert.equal(lines.length, 3); // başlık + 2 sipariş (not içindeki satır sonu boşluğa çevrildi)
  assert.ok(lines[0].includes('"Sipariş No";"Tarih"'));
  assert.ok(lines[1].includes('"Ali ""Usta"""'));          // tırnak kaçışı
  assert.ok(lines[1].includes('"\'=1+1"'));                // formül enjeksiyonu engellendi
  assert.ok(lines[1].includes('"Masa 3"'));
  assert.ok(lines[1].includes('2× Latte (Orta), 1× Çay (Küçük)'));
  assert.ok(lines[1].includes('"225"'));
  assert.ok(lines[2].includes('"Paket"') && lines[2].includes('"satır sonu"'));
});

// ---------- Eski veritabanı yükseltme ----------

test('eski (tek ürünlü) veritabanı sepet yapısına sorunsuz yükseltilir', () => {
  const file = path.join(os.tmpdir(), `kahve-eski-${process.pid}.db`);
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE orders (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Bekliyor',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO orders VALUES ('abc','Eski','Latte','Orta','',100,'Hazır','2026-01-01T10:00:00.000Z','2026-01-01T10:00:00.000Z');`);
    old.close();

    const upgraded = openDb(file);
    const row = upgraded.prepare('SELECT * FROM orders').get();
    assert.equal(row.name, 'Eski');
    assert.equal(row.number, null);
    assert.equal(row.service, '');
    assert.equal(row.table_no, null);

    const items = upgraded.prepare('SELECT * FROM order_items').all();
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].name, items[0].size, items[0].qty, items[0].unit_price], ['Latte', 'Orta', 1, 100]);
    assert.ok(upgraded.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n > 0);
    upgraded.close();

    // ikinci açılışta aynı satırlar tekrar eklenmez
    const again = openDb(file);
    assert.equal(again.prepare('SELECT COUNT(*) n FROM order_items').get().n, 1);
    again.close();
  } finally {
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  }
});

// ---------- Genel ----------

test('frontend dosyaları aynı sunucudan sunulur', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sipariş verin/);
  assert.equal((await fetch(`${base}/admin.html`)).status, 200);
});

test('CORS: sadece izinli origin kabul edilir', async () => {
  const ok = await fetch(`${base}/api/menu`, { headers: { Origin: 'http://localhost:5500' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  const bad = await fetch(`${base}/api/menu`, { headers: { Origin: 'http://kotu-site.com' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('hız sınırı: aşırı sipariş 429, hatalı anahtar denemeleri 429 (doğru anahtar da engellenir)', async () => {
  const limited = await startServer({
    orderLimit: { windowMs: 60_000, max: 3 },
    loginLimit: { windowMs: 60_000, max: 3 },
  });
  try {
    const order = () => fetch(`${limited.base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(validOrder) });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await order()).status);
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);

    const guess = (token) => fetch(`${limited.base}/api/orders`, { headers: { 'x-admin-token': token } });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await guess('yanlis')).status);
    assert.deepEqual(codes, [401, 401, 401, 429]);
    assert.equal((await guess('test-token')).status, 429);
  } finally {
    await stop(limited.server);
  }
});
