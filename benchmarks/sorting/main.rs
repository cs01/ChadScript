const N: usize = 300000;

fn quicksort(arr: &mut Vec<f64>, lo: i64, hi: i64) {
    if lo >= hi {
        return;
    }
    let pivot = arr[hi as usize];
    let mut i = lo;
    let mut j = lo;
    while j < hi {
        if arr[j as usize] < pivot {
            arr.swap(i as usize, j as usize);
            i += 1;
        }
        j += 1;
    }
    arr.swap(i as usize, hi as usize);
    quicksort(arr, lo, i - 1);
    quicksort(arr, i + 1, hi);
}

fn main() {
    let mut seed: f64 = 42.0;
    let mut arr: Vec<f64> = Vec::new();
    for _ in 0..N {
        seed = (seed * 16807.0) % 2147483647.0;
        arr.push(seed / 2147483647.0);
    }
    let hi = arr.len() as i64 - 1;
    quicksort(&mut arr, 0, hi);

    let mut check = 0.0f64;
    let mut i = 0usize;
    while i < N {
        check += arr[i];
        i += N / 10;
    }
    println!("{}", check);
}
