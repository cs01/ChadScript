package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const needle = "console.log"
const searchDir = "src"

var totalMatches int

func searchFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		if strings.Contains(line, needle) {
			totalMatches++
		}
	}
}

func walkDir(dirPath string) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return
	}
	for _, entry := range entries {
		fullPath := filepath.Join(dirPath, entry.Name())
		if entry.IsDir() {
			walkDir(fullPath)
		} else {
			searchFile(fullPath)
		}
	}
}

func main() {
	start := time.Now()

	walkDir(searchDir)

	elapsed := time.Since(start).Seconds()

	fmt.Printf("Matches:  %d\n", totalMatches)
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
