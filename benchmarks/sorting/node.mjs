const N = 2000000;

function quicksort(arr, lo, hi) {
  if (lo >= hi) return;
  const pivot = arr[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (arr[j] < pivot) {
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      i++;
    }
  }
  const tmp = arr[i];
  arr[i] = arr[hi];
  arr[hi] = tmp;
  quicksort(arr, lo, i - 1);
  quicksort(arr, i + 1, hi);
}

const arr = new Float64Array(N);
let seed = 42;
for (let i = 0; i < N; i++) {
  seed = (seed * 16807) % 2147483647;
  arr[i] = seed / 2147483647;
}

const start = performance.now();
quicksort(arr, 0, N - 1);
const elapsed = (performance.now() - start) / 1000;

console.log(`Elements: ${N}`);
console.log(`First:    ${arr[0]}`);
console.log(`Last:     ${arr[N - 1]}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
