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
  db.exec('DELETE FROM orders; DELETE FROM order_items; DELETE FROM menu_items; DELETE FROM sizes; DELETE FROM settings; DELETE FROM milks; DELETE FROM syrups;');
  db.exec(`INSERT INTO menu_items (name, category, price, allow_milk, allow_syrup) VALUES
    ('Türk Kahvesi','Kahve',60,0,0), ('Latte','Kahve',90,1,1), ('Çay','Diğer',25,0,0);
    INSERT INTO sizes (name, extra, sort_order) VALUES ('Küçük',0,0), ('Orta',10,1), ('Büyük',20,2);
    INSERT INTO milks (name, extra, available, sort_order) VALUES ('Normal süt',0,1,0), ('Yulaf sütü',15,1,1), ('Badem sütü',15,0,2);
    INSERT INTO syrups (name, extra, available, sort_order) VALUES ('Vanilya',10,1,0), ('Karamel',10,1,1), ('Fındık',10,0,2), ('Çikolata',10,1,3);`);
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
  assert.deepEqual((await menuOf()).sizes, [{ name: 'Tek', extra: 0, scale: 1 }, { name: 'Çift', extra: 15, scale: 1 }]);

  assert.equal((await post({ ...validOrder, items: [line('Latte', 'Orta')] })).status, 400);
  assert.equal((await post({ ...validOrder, items: [line('Latte', 'Çift')] })).status, 201);

  const bad = [
    { sizes: [] },
    { sizes: [{ name: '', extra: 0 }] },
    { sizes: [{ name: 'A', extra: -1 }] },
    { sizes: [{ name: 'A', extra: 0 }, { name: 'A', extra: 5 }] },
    { sizes: [{ name: 'A', extra: 0, scale: 0.2 }] },
    { sizes: [{ name: 'A', extra: 0, scale: 4 }] },
    { sizes: [{ name: 'A', extra: 0, scale: '2' }] },
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
  assert.deepEqual(order.items, [{ name: 'Latte', size: 'Orta', milk: 'Normal süt', syrups: [], qty: 1, unitPrice: 100, lineTotal: 100 }]);
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

test('menü kart stili: varsayılan klasik, çekirdeğe geçilir, geçersiz değer reddedilir', async () => {
  const get = async () => (await fetch(base + '/api/settings')).json();
  const put = (body, headers = ADMIN) =>
    fetch(base + '/api/settings', { method: 'PUT', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });

  const first = await get();
  assert.equal(first.menuStyle, 'klasik');
  assert.deepEqual(first.menuStyles, ['klasik', 'cekirdek']);

  assert.equal((await put({ menuStyle: 'cekirdek' }, {})).status, 401); // yetkisiz değiştiremez
  assert.equal((await put({ menuStyle: 'cekirdek' })).status, 200);
  assert.equal((await get()).menuStyle, 'cekirdek');

  for (const bad of ['kare', '', null, 5, 'CEKIRDEK']) {
    assert.equal((await put({ menuStyle: bad })).status, 400, String(bad));
  }
  assert.equal((await get()).menuStyle, 'cekirdek'); // hatalı istek değeri bozmaz

  // başka bir ayar güncellenince stil korunur; klasiğe dönülebilir
  await put({ cafeName: 'Moka Kafe' });
  assert.equal((await get()).menuStyle, 'cekirdek');
  assert.equal((await put({ menuStyle: 'klasik' })).status, 200);
  assert.equal((await get()).menuStyle, 'klasik');
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
  assert.ok(lines[1].includes('2× Latte (Orta, Normal süt), 1× Çay (Küçük)'));
  assert.ok(lines[1].includes('"225"'));
  assert.ok(lines[2].includes('"Paket"') && lines[2].includes('"satır sonu"'));
});

// ---------- Süt ve şurup seçenekleri ----------

const latteWith = (extra = {}, qty = 1, size = 'Orta') => ({ ...validOrder, items: [{ type: 'Latte', size, qty, ...extra }] });

test('menü süt, şurup ve ürün bayraklarını döner', async () => {
  const menu = await menuOf();
  assert.deepEqual(menu.milks.map((m) => [m.name, m.extra, m.available]), [['Normal süt', 0, true], ['Yulaf sütü', 15, true], ['Badem sütü', 15, false]]);
  assert.deepEqual(menu.syrups.map((s) => s.name), ['Vanilya', 'Karamel', 'Fındık', 'Çikolata']);
  const flags = Object.fromEntries(menu.items.map((i) => [i.name, [i.allowsMilk, i.allowsSyrup]]));
  assert.deepEqual(flags, { 'Türk Kahvesi': [false, false], Latte: [true, true], Çay: [false, false] });
});

test('süt seçilmezse varsayılan süt atanır ve fiyatı değiştirmez', async () => {
  const order = await placed(latteWith());
  assert.equal(order.items[0].milk, 'Normal süt');
  assert.equal(order.price, 100);
});

test('süt ve şurup ücretleri birim fiyata eklenir', async () => {
  const oat = await placed(latteWith({ milk: 'Yulaf sütü' }));
  assert.equal(oat.price, 115); // 90 + 10 (Orta) + 15

  const full = await placed(latteWith({ milk: 'Yulaf sütü', syrups: ['Vanilya', 'Karamel'] }, 2));
  assert.equal(full.items[0].unitPrice, 135); // 100 + 15 + 10 + 10
  assert.equal(full.price, 270);
  assert.deepEqual(full.items[0].syrups, ['Karamel', 'Vanilya']);
  assert.equal(full.items[0].milk, 'Yulaf sütü');
});

test('aynı seçenekler (sırası farklı olsa da) birleşir, farklı seçenekler ayrı satır olur', async () => {
  const order = await placed({
    ...validOrder,
    items: [
      { type: 'Latte', size: 'Orta', qty: 1, syrups: ['Vanilya', 'Karamel'] },
      { type: 'Latte', size: 'Orta', qty: 2, syrups: ['Karamel', 'Vanilya'] },
      { type: 'Latte', size: 'Orta', qty: 1, syrups: ['Vanilya'] },
      { type: 'Latte', size: 'Orta', qty: 1, milk: 'Yulaf sütü' },
    ],
  });
  assert.equal(order.items.length, 3);
  assert.equal(order.items.find((i) => i.syrups.length === 2).qty, 3);
});

test('tekrarlanan şurup tek sayılır', async () => {
  const order = await placed(latteWith({ syrups: ['Vanilya', 'Vanilya', ' Vanilya '] }));
  assert.deepEqual(order.items[0].syrups, ['Vanilya']);
  assert.equal(order.price, 110);
});

test('geçersiz süt ve şurup seçimleri 400 döner', async () => {
  const cases = {
    'süt: bilinmeyen': latteWith({ milk: 'Pirinç sütü' }),
    'süt: tükenmiş': latteWith({ milk: 'Badem sütü' }),
    'süt: sayı': latteWith({ milk: 5 }),
    'süt: süt seçeneği olmayan ürün': { ...validOrder, items: [{ type: 'Çay', size: 'Küçük', milk: 'Normal süt' }] },
    'şurup: bilinmeyen': latteWith({ syrups: ['Karpuz'] }),
    'şurup: tükenmiş': latteWith({ syrups: ['Fındık'] }),
    'şurup: 4 tane': latteWith({ syrups: ['Vanilya', 'Karamel', 'Çikolata', 'Fındık'] }),
    'şurup: dizi değil': latteWith({ syrups: 'Vanilya' }),
    'şurup: öğe sayı': latteWith({ syrups: [1] }),
    'şurup: şurup seçeneği olmayan ürün': { ...validOrder, items: [{ type: 'Türk Kahvesi', size: 'Küçük', syrups: ['Vanilya'] }] },
  };
  for (const [label, body] of Object.entries(cases)) {
    const res = await post(body);
    assert.equal(res.status, 400, label);
    assert.ok(Array.isArray((await res.json()).errors), label);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
});

test('3 şuruba kadar izin verilir', async () => {
  const order = await placed(latteWith({ syrups: ['Vanilya', 'Karamel', 'Çikolata'] }));
  assert.equal(order.items[0].syrups.length, 3);
  assert.equal(order.items[0].unitPrice, 130);
});

test('yönetici süt listesini günceller: fiyat, tükendi ve doğrulama', async () => {
  const put = (opts) => adminFetch('/api/menu/milks', 'PUT', { options: opts });
  const ok = await put([{ name: 'Normal süt', extra: 0 }, { name: 'Yulaf sütü', extra: 20 }, { name: 'Badem sütü', extra: 15, available: true }]);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).map((m) => [m.name, m.extra, m.available]), [['Normal süt', 0, true], ['Yulaf sütü', 20, true], ['Badem sütü', 15, true]]);

  assert.equal((await placed(latteWith({ milk: 'Yulaf sütü' }))).price, 120); // yeni fiyat
  assert.equal((await post(latteWith({ milk: 'Badem sütü' }))).status, 201);   // tükenmişti, artık açık

  await put([{ name: 'Normal süt', extra: 0, available: false }]);
  assert.equal((await post(latteWith())).status, 400); // varsayılan süt tükendi

  const bad = [
    { options: 'x' },
    { options: [{ name: '', extra: 0 }] },
    { options: [{ name: 'A', extra: -1 }] },
    { options: [{ name: 'A', extra: 1.5 }] },
    { options: [{ name: 'A', extra: 0 }, { name: 'A', extra: 0 }] },
    { options: [{ name: 'A', extra: 0, available: 'evet' }] },
    { options: Array.from({ length: 13 }, (_, i) => ({ name: 'S' + i, extra: 0 })) },
    {},
  ];
  for (const body of bad) assert.equal((await adminFetch('/api/menu/milks', 'PUT', body)).status, 400, JSON.stringify(body).slice(0, 50));
});

test('yönetici şurup listesini günceller; boş liste kabul edilir', async () => {
  const ok = await adminFetch('/api/menu/syrups', 'PUT', { options: [{ name: 'Lavanta', extra: 12 }, { name: 'Vanilya', extra: 10, available: false }] });
  assert.equal(ok.status, 200);
  assert.equal((await post(latteWith({ syrups: ['Lavanta'] }))).status, 201);
  assert.equal((await post(latteWith({ syrups: ['Vanilya'] }))).status, 400); // tükendi
  assert.equal((await post(latteWith({ syrups: ['Karamel'] }))).status, 400); // listeden çıktı

  assert.equal((await adminFetch('/api/menu/syrups', 'PUT', { options: [] })).status, 200);
  assert.deepEqual((await menuOf()).syrups, []);
});

test('süt ve şurup yönetim uçları anahtarsız 401 döner', async () => {
  for (const url of ['/api/menu/milks', '/api/menu/syrups']) {
    const res = await fetch(base + url, { method: 'PUT', headers: JSON_HEADERS, body: '{"options":[]}' });
    assert.equal(res.status, 401, url);
  }
});

test('ürün için süt/şurup seçeneği açılıp kapatılabilir', async () => {
  const tea = (await menuOf()).items.find((i) => i.name === 'Çay');
  const withSyrup = { ...validOrder, items: [{ type: 'Çay', size: 'Küçük', syrups: ['Vanilya'] }] };
  assert.equal((await post(withSyrup)).status, 400);

  const res = await adminFetch('/api/menu/items/' + tea.id, 'PATCH', { allowsSyrup: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).allowsSyrup, true);
  assert.equal((await post(withSyrup)).status, 201);

  assert.equal((await adminFetch('/api/menu/items/' + tea.id, 'PATCH', { allowsMilk: 'evet' })).status, 400);

  const created = await (await adminFetch('/api/menu/items', 'POST', { name: 'Mocha', price: 95, allowsMilk: true, allowsSyrup: true })).json();
  assert.deepEqual([created.allowsMilk, created.allowsSyrup], [true, true]);
});

test('rapor süt ve şurup tercihlerini sayar; CSV seçenekleri içerir', async () => {
  await placed(latteWith({ milk: 'Yulaf sütü', syrups: ['Vanilya', 'Karamel'] }, 2));
  await placed(latteWith({ syrups: ['Vanilya'] }));

  const r = await (await adminFetch('/api/reports?' + todayRange())).json();
  assert.deepEqual(r.milks, [{ name: 'Yulaf sütü', qty: 2 }, { name: 'Normal süt', qty: 1 }]);
  assert.deepEqual(r.syrups, [{ name: 'Vanilya', qty: 3 }, { name: 'Karamel', qty: 2 }]);

  const csv = Buffer.from(await (await adminFetch('/api/reports/orders.csv?' + todayRange())).arrayBuffer()).subarray(3).toString('utf8');
  assert.ok(csv.includes('2× Latte (Orta, Yulaf sütü, Karamel + Vanilya)'));
  assert.ok(csv.includes('1× Latte (Orta, Normal süt, Vanilya)'));
});

// ---------- Tarifler (içerik ve ml) ve hacim çarpanı ----------

test('yeni kurulumda zengin bir menü ve geçerli tarifler gelir', () => {
  const fresh = openDb(':memory:');
  const items = fresh.prepare('SELECT * FROM menu_items ORDER BY id').all();
  assert.ok(items.length >= 15, 'en az 15 ürün');
  assert.ok(new Set(items.map((i) => i.name)).size === items.length);
  const categories = new Set(items.map((i) => i.category));
  assert.ok(categories.has('Kahve') && categories.has('Soğuk Kahve'));

  for (const item of items) {
    const recipe = JSON.parse(item.recipe);
    assert.ok(recipe.length >= 1 && recipe.length <= 8, item.name + ' tarifi var');
    assert.ok(item.description.length > 10, item.name + ' açıklaması var');
    for (const line of recipe) {
      assert.ok(line.name && Number.isInteger(line.amount) && line.amount > 0, item.name + ': ' + line.name);
      assert.ok(['ml', 'g'].includes(line.unit), item.name + ' birimi');
    }
  }
  // örnek: Latte = 30 ml espresso + 180 ml süt + 30 ml süt köpüğü
  const latte = JSON.parse(items.find((i) => i.name === 'Latte').recipe);
  assert.deepEqual(latte.map((l) => [l.name, l.amount, l.unit]), [['Espresso', 30, 'ml'], ['Süt', 180, 'ml'], ['Süt köpüğü', 30, 'ml']]);

  const sizes = fresh.prepare('SELECT name, scale FROM sizes ORDER BY sort_order').all();
  assert.deepEqual(sizes.map((s) => [s.name, s.scale]), [['Küçük', 1], ['Orta', 1.25], ['Büyük', 1.5]]);
  fresh.close();
});

test('menü API ürünlerle birlikte açıklama ve tarifi döner', async () => {
  const items = (await menuOf()).items;
  assert.ok(items.every((i) => typeof i.description === 'string' && Array.isArray(i.recipe)));
});

test('yönetici ürünün açıklamasını ve tarifini günceller', async () => {
  const latte = (await menuOf()).items.find((i) => i.name === 'Latte');
  const recipe = [
    { name: 'Espresso', amount: 40, unit: 'ml' },
    { name: 'Süt', amount: 160, unit: 'ml' },
    { name: 'Süt köpüğü', amount: 20, unit: 'ml' },
  ];
  const res = await adminFetch('/api/menu/items/' + latte.id, 'PATCH', { description: '  Benim tarifim  ', recipe });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.description, 'Benim tarifim');
  assert.deepEqual(updated.recipe, recipe);

  // birim verilmezse ml sayılır; tarif boşaltılabilir
  const noUnit = await adminFetch('/api/menu/items/' + latte.id, 'PATCH', { recipe: [{ name: 'Su', amount: 100 }] });
  assert.deepEqual((await noUnit.json()).recipe, [{ name: 'Su', amount: 100, unit: 'ml' }]);
  const cleared = await adminFetch('/api/menu/items/' + latte.id, 'PATCH', { recipe: [] });
  assert.deepEqual((await cleared.json()).recipe, []);
});

test('geçersiz tarif ve açıklama 400 döner; ürün değişmez', async () => {
  const tea = (await menuOf()).items.find((i) => i.name === 'Çay');
  const line = (over) => ({ name: 'Süt', amount: 100, unit: 'ml', ...over });
  const bad = {
    'tarif dizi değil': { recipe: 'süt' },
    'çok satır': { recipe: Array.from({ length: 9 }, (_, i) => line({ name: 'S' + i })) },
    'ad boş': { recipe: [line({ name: '' })] },
    'ad uzun': { recipe: [line({ name: 'x'.repeat(31) })] },
    'miktar 0': { recipe: [line({ amount: 0 })] },
    'miktar negatif': { recipe: [line({ amount: -5 })] },
    'miktar ondalık': { recipe: [line({ amount: 1.5 })] },
    'miktar metin': { recipe: [line({ amount: '30' })] },
    'miktar çok büyük': { recipe: [line({ amount: 5000 })] },
    'birim geçersiz': { recipe: [line({ unit: 'litre' })] },
    'satır nesne değil': { recipe: [null] },
    'açıklama uzun': { description: 'x'.repeat(161) },
    'açıklama sayı': { description: 5 },
  };
  for (const [label, body] of Object.entries(bad)) {
    assert.equal((await adminFetch('/api/menu/items/' + tea.id, 'PATCH', body)).status, 400, label);
  }
  const after = (await menuOf()).items.find((i) => i.name === 'Çay');
  assert.deepEqual(after.recipe, tea.recipe);
  assert.equal(after.description, tea.description);
});

test('yeni ürün tarifle eklenebilir; tarif yetkisiz güncellenemez', async () => {
  const recipe = [{ name: 'Espresso', amount: 30, unit: 'ml' }, { name: 'Buz', amount: 80, unit: 'g' }];
  const res = await adminFetch('/api/menu/items', 'POST', { name: 'Espresso Tonic', category: 'Soğuk Kahve', price: 95, description: 'Ferah.', recipe });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.deepEqual(created.recipe, recipe);
  assert.equal(created.description, 'Ferah.');

  const denied = await fetch(base + '/api/menu/items/' + created.id, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ recipe: [] }) });
  assert.equal(denied.status, 401);
});

test('boyutların hacim çarpanı kaydedilir, varsayılan 1 olur, API döner', async () => {
  const ok = await adminFetch('/api/menu/sizes', 'PUT', { sizes: [{ name: 'S', extra: 0, scale: 1 }, { name: 'M', extra: 10, scale: 1.256 }, { name: 'L', extra: 20 }] });
  assert.equal(ok.status, 200);
  const sizes = (await menuOf()).sizes;
  assert.deepEqual(sizes.map((s) => s.scale), [1, 1.26, 1]); // 2 ondalığa yuvarlanır, verilmeyen 1
  // sipariş fiyatı çarpandan etkilenmez, sadece ek ücret kullanılır
  const order = await placed({ ...validOrder, items: [{ type: 'Latte', size: 'M', qty: 1 }] });
  assert.equal(order.price, 100);
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

test('seçenek özelliğinden önceki veritabanı yükseltilir: bilinen kahveler için süt/şurup açılır', () => {
  const file = path.join(os.tmpdir(), 'kahve-secenek-' + process.pid + '.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE orders (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Bekliyor',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, number INTEGER, service TEXT NOT NULL DEFAULT '', table_no INTEGER);
      CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        name TEXT NOT NULL, size TEXT NOT NULL, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL);
      CREATE TABLE menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT 'Kahve',
        price INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sizes (name TEXT PRIMARY KEY, extra INTEGER NOT NULL, sort_order INTEGER NOT NULL);
      INSERT INTO sizes VALUES ('Küçük',0,0), ('Orta',10,1), ('Büyük',20,2);
      INSERT INTO menu_items (name, category, price) VALUES ('Latte','Kahve',90), ('Espresso','Kahve',70), ('Türk Kahvesi','Kahve',60), ('Çay','Diğer',25), ('Özel Karışım','Kahve',99);
      INSERT INTO orders VALUES ('x','Eski','','','',200,'Hazır','2026-01-01T10:00:00.000Z','2026-01-01T10:00:00.000Z',1,'Masa',4);
      INSERT INTO order_items (order_id, name, size, qty, unit_price) VALUES ('x','Latte','Orta',2,100);`);
    old.close();

    const upgraded = openDb(file);
    const original = ['Latte', 'Espresso', 'Türk Kahvesi', 'Çay', 'Özel Karışım'];
    const rows = upgraded.prepare('SELECT * FROM menu_items').all();
    const flags = Object.fromEntries(rows.filter((r) => original.includes(r.name)).map((r) => [r.name, [r.allow_milk, r.allow_syrup]]));
    assert.deepEqual(flags, { Latte: [1, 1], Espresso: [0, 1], 'Türk Kahvesi': [0, 0], Çay: [0, 0], 'Özel Karışım': [0, 0] });

    // bilinen ürünlerin tarifi dolar, bilinmeyen ürün (Özel Karışım) boş kalır
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.equal(JSON.parse(byName.Latte.recipe).length, 3);
    assert.match(byName.Latte.description, /espresso/i);
    assert.equal(byName['Özel Karışım'].recipe, '[]');
    // mevcut ürünlerin fiyatı değişmez, yeni kahveler eklenir
    assert.equal(byName.Latte.price, 90);
    assert.ok(['Doppio', 'Flat White', 'Cortado', 'Mocha', 'Cold Brew'].every((n) => byName[n]));
    assert.ok(rows.length >= 15);
    // mevcut boyutlar korunur ve bilinen adlara hacim çarpanı verilir
    const sizeRows = upgraded.prepare('SELECT name, extra, scale FROM sizes ORDER BY sort_order').all();
    assert.deepEqual(sizeRows.map((s) => [s.name, s.extra, s.scale]), [['Küçük', 0, 1], ['Orta', 10, 1.25], ['Büyük', 20, 1.5]]);

    const item = upgraded.prepare('SELECT * FROM order_items').get();
    assert.equal(item.milk, '');
    assert.equal(item.syrups, '[]');
    assert.equal(item.qty, 2);

    assert.ok(upgraded.prepare('SELECT COUNT(*) n FROM milks').get().n >= 3);
    assert.ok(upgraded.prepare('SELECT COUNT(*) n FROM syrups').get().n >= 3);
    upgraded.close();

    // sonraki açılışlarda bayraklar tekrar ezilmez: barista kapattığı seçenek kapalı kalır
    const again = openDb(file);
    again.prepare("UPDATE menu_items SET allow_milk = 0, recipe = '[]', description = 'Benim tarifim' WHERE name = 'Latte'").run();
    again.prepare("DELETE FROM menu_items WHERE name = 'Doppio'").run();
    again.close();
    const third = openDb(file);
    const latte = third.prepare("SELECT * FROM menu_items WHERE name = 'Latte'").get();
    assert.equal(latte.allow_milk, 0);
    assert.equal(latte.recipe, '[]');                 // barista tarifi sildi: geri yazılmaz
    assert.equal(latte.description, 'Benim tarifim'); // açıklama ezilmedi
    assert.equal(third.prepare("SELECT COUNT(*) n FROM menu_items WHERE name = 'Doppio'").get().n, 0); // silinen ürün geri gelmez
    third.close();
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
