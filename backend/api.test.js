const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('./db');
const { createApp } = require('./app');

const ADMIN = { 'x-admin-token': 'test-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const validOrder = { name: 'Ayşe', type: 'Latte', size: 'Orta', note: 'şekersiz' };

let db, server, base;

before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { adminToken: 'test-token', allowedOrigins: ['http://localhost:5500'] });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => db.exec('DELETE FROM orders'));

const post = (body) =>
  fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

test('menü fiyatlarla birlikte döner', async () => {
  const menu = await (await fetch(`${base}/api/menu`)).json();
  assert.equal(menu.coffees.length, 3);
  assert.ok(menu.statuses.includes('Bekliyor'));
});

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
  const res = await post({ ...validOrder, price: 1, status: 'Teslim Edildi' });
  const { order } = await res.json();
  assert.equal(order.price, 100);
  assert.equal(order.status, 'Bekliyor');
});

test('isim kenarlardaki boşluklardan arındırılır', async () => {
  const { order } = await (await post({ ...validOrder, name: '  Ayşe  ' })).json();
  assert.equal(order.name, 'Ayşe');
});

test('geçersiz girdiler 400 döner', async () => {
  const cases = [
    { ...validOrder, name: '' },
    { ...validOrder, name: 'a'.repeat(51) },
    { ...validOrder, type: 'Çay' },
    { ...validOrder, size: 'XL' },
    { ...validOrder, type: '__proto__' },
    { ...validOrder, note: 'x'.repeat(201) },
    {},
  ];
  for (const body of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.ok(Array.isArray((await res.json()).errors));
  }
});

test('bozuk JSON 400 döner', async () => {
  const res = await fetch(`${base}/api/orders`, { method: 'POST', headers: JSON_HEADERS, body: '{bozuk' });
  assert.equal(res.status, 400);
});

test('eşzamanlı 20 sipariş kaybolmadan kaydedilir', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => post({ ...validOrder, name: `k${i}` }))
  );
  assert.ok(results.every((r) => r.status === 201));
  const all = await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json();
  assert.equal(all.length, 20);
});

test('müşteri kendi siparişini id ile görebilir, olmayan id 404', async () => {
  const { order } = await (await post(validOrder)).json();
  const res = await fetch(`${base}/api/orders/${order.id}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, order.id);
  assert.equal((await fetch(`${base}/api/orders/yok`)).status, 404);
});

test('yönetici uçları anahtar olmadan veya yanlış anahtarla 401 döner', async () => {
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
  const patch = (id, status) =>
    fetch(`${base}/api/orders/${id}/status`, {
      method: 'PATCH', headers: { ...JSON_HEADERS, ...ADMIN }, body: JSON.stringify({ status }),
    });

  const ok = await patch(order.id, 'Hazırlanıyor');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'Hazırlanıyor');

  // Müşteri tarafı yeni durumu görür
  const seen = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.equal(seen.status, 'Hazırlanıyor');

  assert.equal((await patch(order.id, 'Uçtu')).status, 400);
  assert.equal((await patch('yok', 'Hazır')).status, 404);
});

test('liste duruma göre filtrelenir ve yeniden eskiye sıralanır', async () => {
  const a = (await (await post({ ...validOrder, name: 'ilk' })).json()).order;
  await post({ ...validOrder, name: 'ikinci' });
  await fetch(`${base}/api/orders/${a.id}/status`, {
    method: 'PATCH', headers: { ...JSON_HEADERS, ...ADMIN }, body: '{"status":"Hazır"}',
  });

  const all = await (await fetch(`${base}/api/orders`, { headers: ADMIN })).json();
  assert.deepEqual(all.map((o) => o.name), ['ikinci', 'ilk']);

  const ready = await (await fetch(`${base}/api/orders?status=Hazır`, { headers: ADMIN })).json();
  assert.deepEqual(ready.map((o) => o.name), ['ilk']);

  const bad = await fetch(`${base}/api/orders?status=Uçtu`, { headers: ADMIN });
  assert.equal(bad.status, 400);
});

test('yönetici siparişi siler', async () => {
  const { order } = await (await post(validOrder)).json();
  const del = await fetch(`${base}/api/orders/${order.id}`, { method: 'DELETE', headers: ADMIN });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${base}/api/orders/${order.id}`)).status, 404);
  const again = await fetch(`${base}/api/orders/${order.id}`, { method: 'DELETE', headers: ADMIN });
  assert.equal(again.status, 404);
});

test('CORS: sadece izinli origin kabul edilir', async () => {
  const ok = await fetch(`${base}/api/menu`, { headers: { Origin: 'http://localhost:5500' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  const bad = await fetch(`${base}/api/menu`, { headers: { Origin: 'http://kotu-site.com' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});
