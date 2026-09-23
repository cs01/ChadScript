// @category: algorithms
// Binary search variants: exact match, lower/upper bound, search on answer (integer sqrt,
// minimum capacity to ship packages), and rotated-array search.

function binarySearch(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    const v = xs[mid]!;
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function lowerBound(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(xs: readonly number[], target: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function isqrt(n: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (mid * mid <= n) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function shipWithinDays(weights: number[], days: number): number {
  const canShip = (cap: number): boolean => {
    let need = 1;
    let load = 0;
    for (const w of weights) {
      if (load + w > cap) {
        need++;
        load = 0;
      }
      load += w;
    }
    return need <= days;
  };
  let lo = Math.max(...weights);
  let hi = weights.reduce((a, b) => a + b, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (canShip(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function searchRotated(xs: number[], target: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xs[mid] === target) return mid;
    if (xs[lo]! <= xs[mid]!) {
      if (xs[lo]! <= target && target < xs[mid]!) hi = mid - 1;
      else lo = mid + 1;
    } else {
      if (xs[mid]! < target && target <= xs[hi]!) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return -1;
}

const sorted = [1, 3, 3, 3, 5, 8, 13, 21, 34];
for (const t of [3, 4, 34, 0, 100]) {
  console.log(
    `target ${t}: index=${binarySearch(sorted, t)} lower=${lowerBound(sorted, t)} upper=${upperBound(sorted, t)} count=${upperBound(sorted, t) - lowerBound(sorted, t)}`,
  );
}
console.log("isqrt:", [0, 1, 15, 16, 17, 1000000, 2147395600].map(isqrt).join(" "));
console.log(
  "ship:",
  shipWithinDays([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5),
  shipWithinDays([3, 2, 2, 4, 1, 4], 3),
);
const rotated = [15, 18, 22, 3, 5, 9, 12];
console.log(
  "rotated:",
  rotated.map((t) => searchRotated(rotated, t)).join(","),
  searchRotated(rotated, 7),
);
