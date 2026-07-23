use std::collections::HashMap;

const N: usize = 20000;
const Q: usize = 200000;

fn main() {
    let mut m: HashMap<String, f64> = HashMap::new();
    for i in 0..N {
        m.insert(format!("key{}", i), i as f64);
    }
    let mut sum = 0.0f64;
    for q in 0..Q {
        if let Some(v) = m.get(&format!("key{}", q % N)) {
            sum += v;
        }
    }
    println!("{}", sum);
}
