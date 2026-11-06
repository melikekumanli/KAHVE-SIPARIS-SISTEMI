const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

const FILE_PATH = path.join(__dirname, 'orders.json');

// Yeni sipariş ekleme
app.post('/api/orders', (req, res) => {
  const newOrder = req.body;

  let orders = [];
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    orders = data ? JSON.parse(data) : [];
  }

  orders.push(newOrder);

  fs.writeFileSync(FILE_PATH, JSON.stringify(orders, null, 2));

  res.status(201).json({ message: 'Sipariş başarıyla kaydedildi.' });
});

// Tüm siparişleri getirme
app.get('/api/orders', (req, res) => {
  if (fs.existsSync(FILE_PATH)) {
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    const orders = data ? JSON.parse(data) : [];
    res.json(orders);
  } else {
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
