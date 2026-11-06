// Basit bellek içi hız sınırlayıcı: anahtar (ör. IP) başına, zaman penceresi içinde en fazla `max` olay.
function createRateLimiter({ windowMs, max }) {
  const entries = new Map();

  function current(key) {
    const now = Date.now();
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now) return null;
    return entry;
  }

  return {
    // Olayı kaydeder.
    hit(key) {
      if (entries.size > 1000) {
        const now = Date.now();
        for (const [k, e] of entries) if (e.resetAt <= now) entries.delete(k);
      }
      let entry = current(key);
      if (!entry) {
        entry = { count: 0, resetAt: Date.now() + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
    },
    // Sınır aşıldı mı?
    blocked(key) {
      const entry = current(key);
      return !!entry && entry.count >= max;
    },
  };
}

module.exports = { createRateLimiter };
