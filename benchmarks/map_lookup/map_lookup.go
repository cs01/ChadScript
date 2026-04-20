package main

import (
	"fmt"
	"strconv"
	"time"
)

const N = 100000
const Q = 1000000

func main() {
	m := make(map[string]int, N)
	for i := 0; i < N; i++ {
		m["key"+strconv.Itoa(i)] = i
	}

	start := time.Now()
	sum := 0
	for q := 0; q < Q; q++ {
		v, ok := m["key"+strconv.Itoa(q%N)]
		if ok {
			sum += v
		}
	}
	elapsed := time.Since(start).Seconds()

	fmt.Printf("Sum:      %d\n", sum)
	fmt.Printf("Time:     %.6fs\n", elapsed)
}
