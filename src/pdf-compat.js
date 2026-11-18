// The pinned PDF.js build uses map upserts before Safari 18 can provide them.
// This script is embedded in both the display module and the parser worker.
for (const prototype of [Map.prototype, WeakMap.prototype]) {
  const { has, get, set } = prototype;
  const methods = {
    getOrInsert(key, fallback) {
      if (has.call(this, key)) return get.call(this, key);
      set.call(this, key, fallback);
      return fallback;
    },
    getOrInsertComputed(key, compute) {
      if (typeof compute !== 'function') throw new TypeError('Expected a map value initializer');
      if (has.call(this, key)) return get.call(this, key);
      const fallback = compute(key === 0 ? 0 : key);
      set.call(this, key, fallback);
      return fallback;
    },
  };
  for (const [name, method] of Object.entries(methods)) {
    if (typeof prototype[name] !== 'function') {
      Object.defineProperty(prototype, name, { value: method, configurable: true, writable: true });
    }
  }
}

function sumPDFNumbers(values) {
  if (typeof Math.sumPrecise === 'function') return Math.sumPrecise(values);
  // PDF.js uses this for font and stream lengths and some fractional metrics.
  // Compensate for rounding when adding a small value to a large partial sum.
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    if (!Number.isFinite(value) || !Number.isFinite(next)) throw new RangeError('Invalid PDF numeric total');
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  const total = sum + correction;
  if (!Number.isFinite(total)) throw new RangeError('Invalid PDF numeric total');
  return total;
}
