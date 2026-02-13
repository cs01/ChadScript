package main

import (
	"fmt"
	"time"
)

const (
	MinDepth = 4
	MaxDepth = 18
)

type Node struct {
	Left  *Node
	Right *Node
}

func makeTree(depth int) *Node {
	if depth == 0 {
		return &Node{}
	}
	return &Node{Left: makeTree(depth - 1), Right: makeTree(depth - 1)}
}

func checkTree(n *Node) int {
	if n.Left == nil {
		return 1
	}
	return 1 + checkTree(n.Left) + checkTree(n.Right)
}

func main() {
	start := time.Now()

	stretchDepth := MaxDepth + 1
	stretch := makeTree(stretchDepth)
	fmt.Printf("stretch: %d\n", checkTree(stretch))

	longLived := makeTree(MaxDepth)

	for depth := MinDepth; depth <= MaxDepth; depth += 2 {
		iterations := 1 << (MaxDepth - depth + MinDepth)
		check := 0
		for i := 0; i < iterations; i++ {
			check += checkTree(makeTree(depth))
		}
		fmt.Printf("depth %d check: %d\n", depth, check)
	}

	fmt.Printf("long lived: %d\n", checkTree(longLived))

	elapsed := time.Since(start).Seconds()
	fmt.Printf("Time:     %.3fs\n", elapsed)
}
