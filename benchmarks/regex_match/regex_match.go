package main

import (
	"fmt"
	"regexp"
	"time"
)

const N = 100000

func main() {
	strs := make([]string, N)
	for i := 0; i < N; i++ {
		strs[i] = fmt.Sprintf("abc%ddef", i)
	}

	re := regexp.MustCompile(`^[a-z]+([0-9]+)[a-z]*$`)

	start := time.Now()
	hits := 0
	for i := 0; i < N; i++ {
		if re.MatchString(strs[i]) {
			hits++
		}
	}
	elapsed := time.Since(start).Seconds()

	fmt.Printf("Matches:  %d\n", hits)
	fmt.Printf("Time:     %.6fs\n", elapsed)
}
