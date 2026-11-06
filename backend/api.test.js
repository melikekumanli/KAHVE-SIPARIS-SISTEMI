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
const validOrder = { name: 'Ayşe', type: 'Latte', size: 'Orta', note: 'şekersiz' };

function startServer(options = {}) {
  const db = openDb(':memory:');
  const app = createApp(db, {
    adminToken: 'test-token',
    orderLimit: { windowMs: 60_000, max: 1000 },
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

// Her testte siparişler temizlenir; menü ve boyutlar varsayılana döner
beforeEach(() => {
  db.exec('DELETE FROM orders; DELETE FROM menu_items; DELETE FROM sizes; DELETE FROM settings;');
  db.exec(`INSERT INTO menu_items (name, category, price) VALUES
    ('Türk Kahvesi','Kahve',60), ('Latte','Kahve',90), ('Çay','Diğer',25);
    INSERT INTO sizes (name, extra, sort_order) VALUES ('Küçük',0,0), ('Orta',10,1), ('Büyük',20,2);`);
});

const post = (body) =>
  fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
const adminFetch = (url, method, body) =>
  fetch(`${base}${url}`, { method, headers: { ...JSON_HEADERS, ...ADMIN }, body: body ? JSON.stringify(body) : undefined });

// ---------- Menü ----------

test('menü ürünler, boyutlar ve durumlarla birlikte döner', async () => {
  const menu = await (await fetch(`${base}/api/menu`)).json();
  assert.deepEqual(menu.items.map((i) => i.name), ['Türk Kahvesi', 'Latte', 'Çay']);
  assert.equal(menu.items[0].available, true);
  assert.deepEqual(menu.sizes.map((s) => s.name), ['Küçük', 'Orta', 'Büyük']);
  assert.ok(menu.statuses.includes('Bekliyor'));
});

test('yönetici ürün ekler; müşteri hemen sipariş verebilir', async () => {
  const res = await adminFetch('/api/menu/items', 'POST', { name: 'Mocha', category: 'Kahve', price: 95 });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.available, true);

  const order = await post({ name: 'x', type: 'Mocha', size: 'Küçük' });
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

test('yönetici fiyatı günceller; yeni sipariş yeni fiyatla, eski sipariş eski fiyatla kalır', async () => {
  const first = (await (await post(validOrder)).json()).order; // Latte 90 + Orta 10
  const items = (await (await fetch(`${base}/api/menu`)).json()).items;
  const latte = items.find((i) => i.name === 'Latte');

  const res = await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { price: 100 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).price, 100);

  const second = (await (await post(validOrder)).json()).order;
  assert.equal(second.price, 110);

  const stored = await (await fetch(`${base}/api/orders/${first.id}`)).json();
  assert.equal(stored.price, 100); // eski sipariş değişmedi
});

test('tükendi işaretlenen ürün sipariş edilemez, tekrar açılınca edilir', async () => {
  const latte = (await (await fetch(`${base}/api/menu`)).json()).items.find((i) => i.name === 'Latte');
  await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { available: false });

  const blocked = await post(validOrder);
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).errors[0], /tükendi/);

  await adminFetch(`/api/menu/items/${latte.id}`, 'PATCH', { available: true });
  assert.equal((await post(validOrder)).status, 201);
});

test('ürün güncelleme: olmayan ürün 404, çakışan ad 409, geçersiz alan 400', async () => {
  const items = (await (await fetch(`${base}/api/menu`)).json()).items;
  assert.equal((await adminFetch('/api/menu/items/99999', 'PATCH', { price: 5 })).status, 404);
  assert.equal((await adminFetch('/api/menu/items/abc', 'PATCH', { price: 5 })).status, 404);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { name: 'Latte' })).status, 409);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { available: 'evet' })).status, 400);
  assert.equal((await adminFetch(`/api/menu/items/${items[0].id}`, 'PATCH', { price: -1 })).status, 400);
});

test('ürün silinince menüden kalkar ama eski siparişi bozulmaz', async () => {
  const order = (await (await post(validOrder)).json()).order;
  const latte = (await (await fetch(`${base}/api/menu`)).json()).items.find((i) => i.name === 'Latte');

  assert.equal((await adminFetch(`/api/menu/items/${latte.id}`, 'DELETE')).status, 204);
  assert.equal((await adminFetch(`/api/menu/items/${latte.id}`, 'DELETE')).status, 404);
  assert.equal((await post(validOrder)).status, 400);

  const stored = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.equal(stored.type, 'Latte');
  assert.equal(stored.price, 100);
});

test('boyutlar topluca güncellenir ve doğrulanır', async () => {
  const ok = await adminFetch('/api/menu/sizes', 'PUT', { sizes: [{ name: 'Tek', extra: 0 }, { name: 'Çift', extra: 15 }] });
  assert.equal(ok.status, 200);
  const menu = await (await fetch(`${base}/api/menu`)).json();
  assert.deepEqual(menu.sizes, [{ name: 'Tek', extra: 0 }, { name: 'Çift', extra: 15 }]);

  assert.equal((await post({ ...validOrder, size: 'Orta' })).status, 400); // eski boyut yok
  assert.equal((await post({ ...validOrder, size: 'Çift' })).status, 201);

  const bad = [
    { sizes: [] },
    { sizes: [{ name: '', extra: 0 }] },
    { sizes: [{ name: 'A', extra: -1 }] },
    { sizes: [{ name: 'A', extra: 0 }, { name: 'A', extra: 5 }] },
    { sizes: Array.from({ length: 7 }, (_, i) => ({ name: 'B' + i, extra: 0 })) },
    {},
  ];
  for (const body of bad) assert.equal((await adminFetch('/api/menu/sizes', 'PUT', body)).status, 400, JSON.stringify(body).slice(0, 50));
  // Hatalı istek mevcut boyutları bozmaz
  assert.equal((await (await fetch(`${base}/api/menu`)).json()).sizes.length, 2);
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

// ---------- Siparişler ----------

test('geçerli sipariş kaydedilir, fiyat sunucuda hesaplanır', async () => {
  const res = await post(validOrder);
  assert.equal(res.status, 201);
  const { order } = await res.json();
  assert.equal(order.name, 'Ayşe');
  assert.equal(order.price, 100); // Latte 90 + Orta 10
  assert.equal(order.status, 'Bekliyor');
  assert.match(order.id, /^[0-9a-f-]{36}$/);
});

test('istemcinin gönderdiği fiyat ve durum yok sayılır', async () => {
  const { order } = await (await post({ ...validOrder, price: 1, status: 'Teslim Edildi' })).json();
  assert.equal(order.price, 100);
  assert.equal(order.status, 'Bekliyor');
});

test('isim kenarlardaki boşluklardan arındırılır', async () => {
  const { order } = await (await post({ ...validOrder, name: '  Ayşe  ' })).json();
  assert.equal(order.name, 'Ayşe');
});

test('geçersiz sipariş girdileri 400 döner', async () => {
  const cases = [
    { ...validOrder, name: '' },
    { ...validOrder, name: 'a'.repeat(51) },
    { ...validOrder, type: 'Pizza' },
    { ...validOrder, type: 123 },
    { ...validOrder, size: 'XL' },
    { ...validOrder, note: 'x'.repeat(201) },
    {},
  ];
  for (const body of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.ok(Array.isArray((await res.json()).errors));
  }
});

test('SQL enjeksiyon denemesi zararsızdır', async () => {
  const res = await post({ ...validOrder, name: "x'); DROP TABLE orders;--" });
  assert.equal(res.status, 201);
  assert.equal((await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json()).length, 1);
});

test('bozuk JSON 400 döner', async () => {
  const res = await fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: '{bozuk' });
  assert.equal(res.status, 400);
});

test('eşzamanlı 20 sipariş kaybolmadan kaydedilir', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ ...validOrder, name: `k${i}` })));
  assert.ok(results.every((r) => r.status === 201));
  assert.equal((await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json()).length, 20);
});

test('müşteri kendi siparişini id ile görebilir, olmayan id 404', async () => {
  const { order } = await (await post(validOrder)).json();
  const res = await fetch(`${base}/api/orders/${order.id}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, order.id);
  assert.equal((await fetch(`${base}/api/orders/yok`)).status, 404);
});

test('sipariş yönetim uçları anahtar olmadan veya yanlış anahtarla 401 döner', async () => {
  const { order } = await (await post(validOrder)).json();
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
  const { order } = await (await post(validOrder)).json();
  const ok = await adminFetch(`/api/orders/${order.id}/status`, 'PATCH', { status: 'Hazırlanıyor' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'Hazırlanıyor');
  assert.equal((await (await fetch(`${base}/api/orders/${order.id}`)).json()).status, 'Hazırlanıyor');
  assert.equal((await adminFetch(`/api/orders/${order.id}/status`, 'PATCH', { status: 'Uçtu' })).status, 400);
  assert.equal((await adminFetch('/api/orders/yok/status', 'PATCH', { status: 'Hazır' })).status, 404);
});

test('liste duruma göre filtrelenir ve yeniden eskiye sıralanır', async () => {
  const a = (await (await post({ ...validOrder, name: 'ilk' })).json()).order;
  await post({ ...validOrder, name: 'ikinci' });
  await adminFetch(`/api/orders/${a.id}/status`, 'PATCH', { status: 'Hazır' });

  const all = await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json();
  assert.deepEqual(all.map((o) => o.name), ['ikinci', 'ilk']);
  const ready = await (await fetch(`${base}/api/orders?status=Hazır`, { headers: ADMIN })).json();
  assert.deepEqual(ready.map((o) => o.name), ['ilk']);
  assert.equal((await fetch(`${base}/api/orders?status=Uçtu`, { headers: ADMIN })).status, 400);
});

test('yönetici siparişi siler', async () => {
  const { order } = await (await post(validOrder)).json();
  assert.equal((await adminFetch(`/api/orders/${order.id}`, 'DELETE')).status, 204);
  assert.equal((await fetch(`${base}/api/orders/${order.id}`)).status, 404);
  assert.equal((await adminFetch(`/api/orders/${order.id}`, 'DELETE')).status, 404);
});

// ---------- Sipariş numarası, arşiv, ayarlar ----------

test('sipariş numarası birden başlayıp birer artar', async () => {
  const numbers = [];
  for (let i = 0; i < 3; i++) numbers.push((await (await post(validOrder)).json()).order.number);
  assert.deepEqual(numbers, [1, 2, 3]);
  const first = (await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json()).at(-1);
  assert.equal(first.number, 1);
});

test('scope=active teslim edilenleri (arşiv) hariç tutar; limit en yeni N siparişi verir', async () => {
  const ids = [];
  for (const name of ['a', 'b', 'c', 'd']) ids.push((await (await post({ ...validOrder, name })).json()).order.id);
  await adminFetch(`/api/orders/${ids[0]}/status`, 'PATCH', { status: 'Teslim Edildi' });
  await adminFetch(`/api/orders/${ids[1]}/status`, 'PATCH', { status: 'Teslim Edildi' });

  const get = async (q) => (await (await fetch(`${base}/api/orders${q}`, { headers: ADMIN })).json()).map((o) => o.name);
  assert.deepEqual(await get('?scope=active'), ['d', 'c']);
  assert.deepEqual(await get('?status=Teslim%20Edildi'), ['b', 'a']);
  assert.deepEqual(await get('?limit=3'), ['d', 'c', 'b']);
  assert.deepEqual(await get('?status=Teslim%20Edildi&limit=1'), ['b']);

  for (const q of ['?limit=0', '?limit=501', '?limit=abc', '?limit=-1', '?scope=hepsi', '?status=x']) {
    assert.equal((await fetch(`${base}/api/orders${q}`, { headers: ADMIN })).status, 400, q);
  }
});

test('ayarlar: varsayılanlar herkese açık, güncelleme sadece yöneticiye', async () => {
  const s = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(s.cafeName, 'Kahve Sipariş');
  assert.equal(s.theme, 'kahve');
  assert.ok(s.themes.includes('zeytin'));

  const put = (body, headers = ADMIN) =>
    fetch(`${base}/api/settings`, { method: 'PUT', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });

  assert.equal((await put({ cafeName: 'X' }, {})).status, 401);

  const ok = await put({ cafeName: '  Moka Kafe  ', tagline: 'Her gün taze', theme: 'zeytin' });
  assert.equal(ok.status, 200);
  const saved = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(saved.cafeName, 'Moka Kafe');
  assert.equal(saved.tagline, 'Her gün taze');
  assert.equal(saved.theme, 'zeytin');

  // kısmi güncelleme diğer alanları bozmaz
  await put({ theme: 'bordo' });
  const partial = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(partial.cafeName, 'Moka Kafe');
  assert.equal(partial.theme, 'bordo');

  for (const bad of [{ cafeName: '' }, { cafeName: 'x'.repeat(41) }, { tagline: 'x'.repeat(81) }, { theme: 'pembe' }, { cafeName: 5 }]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  }
});

test('numara sütunu olmayan eski veritabanı sorunsuz yükseltilir', () => {
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
    assert.ok(upgraded.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n > 0);
    upgraded.close();
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
