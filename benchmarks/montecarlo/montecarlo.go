package main

import (
	"fmt"
	"time"
)

const SAMPLES = 50000000

func main() {
	seed := int64(42)
	inside := int64(0)

	start := time.Now()

	for i := 0; i < SAMPLES; i++ {
		seed = (seed * 16807) % 2147483647
		x := float64(seed) / 2147483647.0
		seed = (seed * 16807) % 2147483647
		y := float64(seed) / 2147483647.0
		if x*x+y*y <= 1.0 {
			inside++
		}
	}

	elapsed := time.Since(start).Seconds()
	pi := 4.0 * float64(inside) / float64(SAMPLES)

	fmt.Printf("Samples:  %d\n", SAMPLES)
	fmt.Printf("Pi:       %.15f\n", pi)
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
