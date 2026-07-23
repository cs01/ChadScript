const SAMPLES: i64 = 20000000;

fn montecarlo() -> f64 {
    // f64 throughout, matching JS number semantics exactly (the LCG stays well inside 2^53).
    let mut seed: f64 = 42.0;
    let mut inside: f64 = 0.0;
    let mut i: i64 = 0;
    while i < SAMPLES {
        seed = (seed * 16807.0) % 2147483647.0;
        let x = seed / 2147483647.0;
        seed = (seed * 16807.0) % 2147483647.0;
        let y = seed / 2147483647.0;
        if x * x + y * y <= 1.0 {
            inside += 1.0;
        }
        i += 1;
    }
    (4.0 * inside) / SAMPLES as f64
}

fn main() {
    println!("{}", montecarlo());
}
