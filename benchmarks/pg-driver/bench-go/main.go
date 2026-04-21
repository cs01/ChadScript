// Go pgx benchmark. Build: cd bench-go; go build -o /tmp/bench-go
package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

const ITERS = 10000
const RUNS = 3

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func runOnce(ctx context.Context) (int64, error) {
	user := env("PGUSER", "postgres")
	db := env("PGDATABASE", "postgres")
	pw := env("PGPASSWORD", "")
	dsn := fmt.Sprintf("postgres://%s:%s@127.0.0.1:5432/%s?sslmode=disable", user, pw, db)
	c, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return 0, err
	}
	defer c.Close(ctx)
	c.Exec(ctx, "SELECT 1")
	t0 := time.Now()
	for i := 0; i < ITERS; i++ {
		if _, err := c.Exec(ctx, "SELECT 1"); err != nil {
			return 0, err
		}
	}
	return time.Since(t0).Milliseconds(), nil
}

func main() {
	ctx := context.Background()
	results := make([]int64, RUNS)
	for r := 0; r < RUNS; r++ {
		ms, err := runOnce(ctx)
		if err != nil {
			fmt.Println("FAIL:", err)
			os.Exit(1)
		}
		results[r] = ms
	}
	sort.Slice(results, func(i, j int) bool { return results[i] < results[j] })
	mid := results[1]
	fmt.Printf("go-pgx iters=%d runs=%d\n", ITERS, RUNS)
	fmt.Printf("runs_ms=%d,%d,%d\n", results[0], results[1], results[2])
	fmt.Printf("median_ms=%d qps=%d\n", mid, (ITERS*1000)/mid)
}
