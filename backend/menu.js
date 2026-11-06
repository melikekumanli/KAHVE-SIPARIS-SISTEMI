// Menü ve fiyatlar tek yerde tutulur; fiyat hesabı her zaman sunucuda yapılır.
const COFFEES = {
  'Türk Kahvesi': 60,
  'Latte': 90,
  'Espresso': 70,
};

// Boyuta göre eklenen ücret
const SIZES = {
  'Küçük': 0,
  'Orta': 10,
  'Büyük': 20,
};

const STATUSES = ['Bekliyor', 'Hazırlanıyor', 'Hazır', 'Teslim Edildi'];

function calculatePrice(type, size) {
  return COFFEES[type] + SIZES[size];
}

function getMenu() {
  return {
    coffees: Object.entries(COFFEES).map(([name, price]) => ({ name, price })),
    sizes: Object.entries(SIZES).map(([name, extra]) => ({ name, extra })),
    statuses: STATUSES,
  };
}

module.exports = { COFFEES, SIZES, STATUSES, calculatePrice, getMenu };
