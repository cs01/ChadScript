package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	url := flag.String("url", "http://127.0.0.1:9876/", "URL to benchmark")
	concurrency := flag.Int("c", 100, "concurrent workers")
	duration := flag.Duration("d", 10*time.Second, "test duration")
	keepalive := flag.Bool("keepalive", false, "enable keep-alive (reuse connections)")
	flag.Parse()

	transport := &http.Transport{
		MaxIdleConnsPerHost: *concurrency,
		MaxConnsPerHost:     *concurrency,
		DisableKeepAlives:   !*keepalive,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
	}

	type result struct {
		latencies []time.Duration
		count     int64
		errors    int64
	}

	results := make([]result, *concurrency)
	var ready sync.WaitGroup
	var done int64

	ready.Add(*concurrency)
	start := time.Now()

	for i := 0; i < *concurrency; i++ {
		go func(idx int) {
			ready.Done()
			ready.Wait()
			var lats []time.Duration
			var count, errs int64
			for atomic.LoadInt64(&done) == 0 {
				r, _ := http.NewRequest("GET", *url, nil)
				t0 := time.Now()
				resp, err := client.Do(r)
				elapsed := time.Since(t0)
				if err != nil {
					errs++
					continue
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				count++
				lats = append(lats, elapsed)
			}
			results[idx] = result{lats, count, errs}
		}(i)
	}

	ready.Wait()
	time.Sleep(*duration)
	atomic.StoreInt64(&done, 1)
	time.Sleep(200 * time.Millisecond)

	totalTime := time.Since(start) - 200*time.Millisecond

	var totalReqs, totalErrs int64
	var allLats []time.Duration
	for _, r := range results {
		totalReqs += r.count
		totalErrs += r.errors
		allLats = append(allLats, r.latencies...)
	}

	sort.Slice(allLats, func(i, j int) bool { return allLats[i] < allLats[j] })

	rps := float64(totalReqs) / totalTime.Seconds()

	fmt.Printf("Requests:    %d\n", totalReqs)
	fmt.Printf("Errors:      %d\n", totalErrs)
	fmt.Printf("Duration:    %.2fs\n", totalTime.Seconds())
	fmt.Printf("Req/sec:     %.0f\n", rps)
	if len(allLats) > 0 {
		var total time.Duration
		for _, l := range allLats {
			total += l
		}
		avg := total / time.Duration(len(allLats))
		p50 := allLats[len(allLats)*50/100]
		p99 := allLats[len(allLats)*99/100]
		fmt.Printf("Latency avg: %s\n", avg.Truncate(time.Microsecond))
		fmt.Printf("Latency p50: %s\n", p50.Truncate(time.Microsecond))
		fmt.Printf("Latency p99: %s\n", p99.Truncate(time.Microsecond))
	}
}
