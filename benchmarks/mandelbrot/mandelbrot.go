package main

import (
	"fmt"
	"time"
)

func main() {
	const W = 4096
	const H = 4096
	const maxIter = 100

	start := time.Now()
	totalIter := 0

	for py := 0; py < H; py++ {
		for px := 0; px < W; px++ {
			x0 := float64(px)*3.5/float64(W) - 2.5
			y0 := float64(py)*2.0/float64(H) - 1.0
			x, y := 0.0, 0.0
			iter := 0
			for iter < maxIter && x*x+y*y <= 4.0 {
				t := x*x - y*y + x0
				y = 2.0*x*y + y0
				x = t
				iter++
			}
			totalIter += iter
		}
	}

	elapsed := time.Since(start).Seconds()
	fmt.Printf("Size:     %dx%d\n", W, H)
	fmt.Printf("Time:     %.3fs\n", elapsed)
	fmt.Printf("Iters:    %d\n", totalIter)
}
