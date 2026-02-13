package main

import (
	"encoding/json"
	"fmt"
	"time"
)

const COUNT = 10000

type Item struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Value  float64 `json:"value"`
	Active bool    `json:"active"`
}

func main() {
	jsonStrings := make([]string, COUNT)
	for i := 0; i < COUNT; i++ {
		jsonStrings[i] = fmt.Sprintf(`{"id":%d,"name":"item%d","value":%.2f,"active":true}`, i, i, float64(i)*3.14)
	}

	start := time.Now()

	items := make([]Item, COUNT)
	for i := 0; i < COUNT; i++ {
		json.Unmarshal([]byte(jsonStrings[i]), &items[i])
	}

	outputs := make([]string, COUNT)
	for i := 0; i < COUNT; i++ {
		b, _ := json.Marshal(items[i])
		outputs[i] = string(b)
	}

	elapsed := time.Since(start).Seconds()
	fmt.Printf("Objects:  %d\n", COUNT)
	fmt.Printf("Check:    %s\n", items[0].Name)
	fmt.Printf("OutLen:   %d\n", len(outputs[0]))
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
