// Quicksort over a generated array: array element writes (the swap), recursion, comparisons.
// Reads go through `?? 0` because noUncheckedIndexedAccess types `arr[i]` as `number | undefined`.
const N = 300000;

function quicksort(arr: number[], lo: number, hi: number): void {
  if (lo >= hi) return;
  const pivot = arr[hi] ?? 0;
  let i = lo;
  let j = lo;
  while (j < hi) {
    if ((arr[j] ?? 0) < pivot) {
      const tmp = arr[i] ?? 0;
      arr[i] = arr[j] ?? 0;
      arr[j] = tmp;
      i = i + 1;
    }
    j = j + 1;
  }
  const tmp = arr[i] ?? 0;
  arr[i] = arr[hi] ?? 0;
  arr[hi] = tmp;
  quicksort(arr, lo, i - 1);
  quicksort(arr, i + 1, hi);
}

let seed = 42;
const arr: number[] = [];
for (let i = 0; i < N; i++) {
  seed = (seed * 16807) % 2147483647;
  arr.push(seed / 2147483647);
}
quicksort(arr, 0, arr.length - 1);

// Print a checksum rather than the array: order is what matters, and it must match exactly.
let check = 0;
for (let i = 0; i < N; i += N / 10) {
  check = check + (arr[i] ?? 0);
}
console.log(check);
