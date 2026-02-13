const N = 2000000;

function quicksort(arr: number[], lo: number, hi: number): void {
  if (lo >= hi) return;
  const pivot = arr[hi];
  let i = lo;
  let j = lo;
  while (j < hi) {
    if (arr[j] < pivot) {
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      i = i + 1;
    }
    j = j + 1;
  }
  const tmp = arr[i];
  arr[i] = arr[hi];
  arr[hi] = tmp;
  quicksort(arr, lo, i - 1);
  quicksort(arr, i + 1, hi);
}

function run(): void {
  let seed = 42;
  const arr: number[] = [];
  let i = 0;
  while (i < N) {
    seed = (seed * 16807) % 2147483647;
    arr.push(seed / 2147483647);
    i = i + 1;
  }

  const start = Date.now();
  quicksort(arr, 0, N - 1);
  const elapsed = (Date.now() - start) / 1000;

  console.log("Elements: " + N);
  console.log("First:    " + arr[0]);
  console.log("Last:     " + arr[N - 1]);
  console.log("Time:     " + elapsed + "s");
}

run();
