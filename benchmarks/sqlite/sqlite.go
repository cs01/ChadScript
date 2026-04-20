package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)"); err != nil {
		log.Fatal(err)
	}

	for i := 0; i < 100; i++ {
		if _, err := db.Exec("INSERT INTO t VALUES (?, ?)", i, fmt.Sprintf("value_%d", i)); err != nil {
			log.Fatal(err)
		}
	}

	const iterations = 100000
	start := time.Now()

	for j := 0; j < iterations; j++ {
		id := j % 100
		var val string
		if err := db.QueryRow("SELECT val FROM t WHERE id = ?", id).Scan(&val); err != nil {
			log.Fatal(err)
		}
	}

	elapsed := time.Since(start).Seconds()
	qps := int(float64(iterations) / elapsed)

	fmt.Printf("Queries:  %d\n", iterations)
	fmt.Printf("Time:     %.3fs\n", elapsed)
	fmt.Printf("QPS:      %d\n", qps)
}
