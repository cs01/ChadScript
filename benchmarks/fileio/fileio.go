package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	ChunkSize = 100 * 1024
	Chunks    = 1024
	FilePath  = "/tmp/bench-fileio-test.dat"
)

func main() {
	chunk := strings.Repeat("A", ChunkSize)

	start := time.Now()

	f, _ := os.Create(FilePath)
	for i := 0; i < Chunks; i++ {
		f.WriteString(chunk)
	}
	f.Close()

	totalSize := ChunkSize * Chunks

	data, _ := os.ReadFile(FilePath)

	elapsed := time.Since(start).Seconds()

	os.Remove(FilePath)

	fmt.Printf("Written:  %d\n", totalSize)
	fmt.Printf("Read:     %d\n", len(data))
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
