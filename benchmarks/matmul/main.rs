fn matmul(n: usize) -> f64 {
    let mut a = vec![0.0f64; n * n];
    let mut b = vec![0.0f64; n * n];
    for i in 0..n * n {
        a[i] = ((i % 7) + 1) as f64;
        b[i] = ((i % 5) + 1) as f64;
    }
    let mut c = vec![0.0f64; n * n];
    for i in 0..n {
        for k in 0..n {
            let aik = a[i * n + k];
            for j in 0..n {
                c[i * n + j] += aik * b[k * n + j];
            }
        }
    }
    c.iter().sum()
}

fn main() {
    println!("{}", matmul(320));
}
