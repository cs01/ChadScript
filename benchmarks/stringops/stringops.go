package main

import (
	"fmt"
	"strings"
	"time"
)

const COUNT = 100000

func main() {
	start := time.Now()

	var b strings.Builder
	for i := 0; i < COUNT; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "item%d", i)
	}
	big := b.String()

	parts := strings.Split(big, ",")
	for i, p := range parts {
		parts[i] = strings.ToUpper(p)
	}
	result := strings.Join(parts, ",")

	elapsed := time.Since(start).Seconds()
	fmt.Printf("Strings:  %d\n", COUNT)
	fmt.Printf("Length:   %d\n", len(result))
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
