fn fib(n: f64) -> f64 {
    if n < 2.0 {
        return n;
    }
    fib(n - 1.0) + fib(n - 2.0)
}

fn main() {
    // f64 throughout so all three languages do the same arithmetic (JS numbers are f64).
    println!("{}", fib(35.0));
}
