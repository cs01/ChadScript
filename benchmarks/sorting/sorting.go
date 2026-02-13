package main

import (
	"fmt"
	"time"
)

const N = 2000000

func quicksort(arr []float64, lo, hi int) {
	if lo >= hi {
		return
	}
	pivot := arr[hi]
	i := lo
	for j := lo; j < hi; j++ {
		if arr[j] < pivot {
			arr[i], arr[j] = arr[j], arr[i]
			i++
		}
	}
	arr[i], arr[hi] = arr[hi], arr[i]
	quicksort(arr, lo, i-1)
	quicksort(arr, i+1, hi)
}

func main() {
	arr := make([]float64, N)
	seed := int64(42)
	for i := 0; i < N; i++ {
		seed = (seed * 16807) % 2147483647
		arr[i] = float64(seed) / 2147483647.0
	}

	start := time.Now()
	quicksort(arr, 0, N-1)
	elapsed := time.Since(start).Seconds()

	fmt.Printf("Elements: %d\n", N)
	fmt.Printf("First:    %.15f\n", arr[0])
	fmt.Printf("Last:     %.15f\n", arr[N-1])
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
