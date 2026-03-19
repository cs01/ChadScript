function swap(arr: number[], a: number, b: number): void {
  const tmp = arr[a];
  arr[a] = arr[b];
  arr[b] = tmp;
}

function partition(arr: number[], lo: number, hi: number): number {
  const pivot = arr[hi];
  let i = lo - 1;
  for (let j = lo; j < hi; j++) {
    if (arr[j] <= pivot) {
      i = i + 1;
      swap(arr, i, j);
    }
  }
  swap(arr, i + 1, hi);
  return i + 1;
}

function quicksort(arr: number[], lo: number, hi: number): void {
  if (lo < hi) {
    const p = partition(arr, lo, hi);
    quicksort(arr, lo, p - 1);
    quicksort(arr, p + 1, hi);
  }
}

const data = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
quicksort(data, 0, data.length - 1);

let sorted = true;
for (let i = 0; i < data.length; i++) {
  if (data[i] !== i) {
    sorted = false;
  }
}

if (sorted) {
  console.log("TEST_PASSED");
}
