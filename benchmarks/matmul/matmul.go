package main

import (
	"fmt"
	"time"
)

func main() {
	const N = 512
	a := make([]float64, N*N)
	b := make([]float64, N*N)
	c := make([]float64, N*N)

	for i := range a {
		a[i] = float64(i%N) + 0.1
		b[i] = float64(i/N) + 0.1
	}

	start := time.Now()

	for row := 0; row < N; row++ {
		for col := 0; col < N; col++ {
			var sum float64
			for k := 0; k < N; k++ {
				sum += a[row*N+k] * b[k*N+col]
			}
			c[row*N+col] = sum
		}
	}

	elapsed := time.Since(start).Seconds()
	gflops := float64(2*N*N*N) / elapsed / 1e9
	fmt.Printf("Size:     %dx%d\n", N, N)
	fmt.Printf("Time:     %.3fs\n", elapsed)
	fmt.Printf("GFLOPS:   %.2f\n", gflops)
	_ = c[0]
}
