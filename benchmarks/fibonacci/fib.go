package main

import (
	"fmt"
	"time"
)

func fib(n int) int {
	if n <= 1 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

func main() {
	start := time.Now()
	result := fib(42)
	elapsed := time.Since(start).Seconds()
	fmt.Printf("fib(42) = %d\n", result)
	fmt.Printf("Time:   %.3fs\n", elapsed)
}
