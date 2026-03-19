#!/usr/bin/env python3
import json, os, sys
from datetime import datetime, timezone

json_dir = sys.argv[1]
outfile = sys.argv[2]
startup_runs = int(sys.argv[3]) if len(sys.argv) > 3 else 50

META = {
    "startup":       {"name": "Cold Start", "desc": f"Time to print 'Hello, World!' and exit. Average of {startup_runs} runs.", "metric": "ms", "lower_is_better": True},
    "sqlite":        {"name": "SQLite", "desc": "100K SELECT queries on a 100-row in-memory table.", "metric": "s", "lower_is_better": True},
    "matmul":        {"name": "Matrix Multiply", "desc": "512x512 double-precision matrix multiply.", "metric": "s", "lower_is_better": True},
    "montecarlo":    {"name": "Monte Carlo Pi", "desc": "100M Monte Carlo samples to estimate Pi.", "metric": "s", "lower_is_better": True},
    "fibonacci":     {"name": "Fibonacci", "desc": "fib(42) naive recursion.", "metric": "s", "lower_is_better": True},
    "http":          {"name": "HTTP Server", "desc": "HTTP hello-world, 100 concurrent, no keep-alive.", "metric": "req/s", "lower_is_better": False},
    "http_keepalive":{"name": "HTTP Keep-Alive", "desc": "HTTP hello-world, 100 concurrent, keep-alive enabled.", "metric": "req/s", "lower_is_better": False},
    "websocket":     {"name": "WebSocket Echo", "desc": "WebSocket echo, 32 clients.", "metric": "msg/s", "lower_is_better": False},
    "sieve":         {"name": "Sieve of Eratosthenes", "desc": "Find all primes up to 10M.", "metric": "s", "lower_is_better": True},
    "sorting":       {"name": "Quicksort", "desc": "Quicksort 2M doubles (deterministic LCG).", "metric": "s", "lower_is_better": True},
    "nbody":         {"name": "N-Body Simulation", "desc": "5-body simulation, 50M timesteps.", "metric": "s", "lower_is_better": True},
    "stringops":     {"name": "String Manipulation", "desc": "Concatenate 100K strings, split, toUpperCase, join.", "metric": "s", "lower_is_better": True},
    "fileio":        {"name": "File I/O", "desc": "Write and read ~100MB to /tmp.", "metric": "s", "lower_is_better": True},
    "binarytrees":   {"name": "Binary Trees", "desc": "Build/check/discard binary trees of depth 18.", "metric": "s", "lower_is_better": True},
    "json":          {"name": "JSON Parse/Stringify", "desc": "Parse 10K JSON objects, stringify back.", "metric": "s", "lower_is_better": True},
    "stringsearch":  {"name": "String Search", "desc": "Recursive directory search for 'console.log' in src/.", "metric": "s", "lower_is_better": True},
}

all_benchmarks = {}
filtered_benchmarks = {}

for fname in sorted(os.listdir(json_dir)):
    if not fname.endswith(".json"):
        continue
    bkey = fname[:-5]
    filepath = os.path.join(json_dir, fname)
    results = {}
    chad_val = None
    for line in open(filepath):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        lang, value, label = parts[0], parts[1], parts[2]
        try:
            results[lang] = {"value": round(float(value), 3), "label": label}
        except ValueError:
            continue
        if lang == "chadscript":
            chad_val = float(value)

    if chad_val is None:
        print(f"  Skipped: {bkey} (no ChadScript result)")
        continue

    meta = META.get(bkey, {"name": bkey, "desc": "", "metric": "s", "lower_is_better": True})
    lower = meta["lower_is_better"]

    entry = {
        "name": meta["name"],
        "desc": meta["desc"],
        "metric": meta["metric"],
        "lower_is_better": lower,
        "results": results,
    }

    all_benchmarks[bkey] = entry

    dominated = False
    for lang, r in results.items():
        if lang in ("chadscript", "c"):
            continue
        if lower and r["value"] < chad_val:
            dominated = True
            break
        if not lower and r["value"] > chad_val:
            dominated = True
            break

    if dominated:
        print(f"  Filtered from docs: {meta['name']} (ChadScript not 1st or 2nd behind C)")
    else:
        filtered_benchmarks[bkey] = entry

ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

os.makedirs(os.path.dirname(outfile), exist_ok=True)
with open(outfile, "w") as f:
    json.dump({"timestamp": ts, "benchmarks": filtered_benchmarks}, f, indent=2)
print(f"  Wrote {len(filtered_benchmarks)} benchmarks to {outfile} (docs, filtered)")

all_outfile = outfile.replace(".json", "-all.json")
with open(all_outfile, "w") as f:
    json.dump({"timestamp": ts, "benchmarks": all_benchmarks}, f, indent=2)
print(f"  Wrote {len(all_benchmarks)} benchmarks to {all_outfile} (PR comments, unfiltered)")
