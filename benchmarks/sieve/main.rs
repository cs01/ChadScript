fn count_primes(limit: usize) -> usize {
    let mut sieve = vec![true; limit + 1];
    let mut count = 0usize;
    for i in 2..=limit {
        if sieve[i] {
            count += 1;
            let mut j = i * i;
            while j <= limit {
                sieve[j] = false;
                j += i;
            }
        }
    }
    count
}

fn main() {
    println!("{}", count_primes(5000000));
}
