#!/usr/bin/env python3
"""
Assembles per-benchmark sample files into the published benchmarks.json.

Input format (one line per language per benchmark, written by `bench_compute` in
benchmarks/run.sh and benchmarks/run-ci.sh):

    lang|comma-separated-samples|raw-label

For example:

    chadscript|0.596,0.584,0.601,0.593,0.599|Time: 0.596s

For each language, we parse all samples and compute:
  - median           → the reported point estimate
  - ci_lo / ci_hi    → 95% bootstrap confidence interval of the median
  - samples          → full list, preserved for transparency / future analysis

Ranking is tie-aware: two languages are considered "tied" when their 95%
confidence intervals overlap, which is the standard non-parametric criterion
for "statistically distinguishable at the 95% level." Spurious medal-flipping
from runner jitter is eliminated because a 2-3% absolute gap between two noisy
measurements lands inside both CIs and is correctly called a tie.

For N=1 (e.g. the startup benchmark, which internally averages 50 launches and
emits one aggregate number), the CI collapses to a single point — we fall back
to a 5% heuristic halo around the value so ranking still works.
"""
import json, os, random, sys
from datetime import datetime, timezone

json_dir = sys.argv[1]
outfile = sys.argv[2]
startup_runs = int(sys.argv[3]) if len(sys.argv) > 3 else 50

# Reproducible bootstrap sampling — same inputs produce same CI every time.
random.seed(0xC4AD)

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
    "cligrep":       {"name": "Recursive Grep", "desc": "cgrep vs grep — search for 'function' across 5x copies of src/.", "metric": "s", "lower_is_better": True, "category": "cli"},
    "clihex":        {"name": "Hex Dump", "desc": "chex vs xxd — hex dump a 5MB binary file.", "metric": "s", "lower_is_better": True, "category": "cli"},
}

N_BOOTSTRAP = 2000
CONFIDENCE = 0.95
# For N=1 or N=2 (bootstrap can't compute a meaningful CI), use a 5% halo
# around the point estimate. This keeps the ranking code functional for
# single-sample benchmarks like `startup`.
FALLBACK_HALO = 0.05
# For N>=3, trust the bootstrap. But enforce a minimum CI width of 1% of the
# point estimate — protects against "all samples identical" giving a
# degenerate (zero-width) CI, which would make microsecond-level differences
# look statsig.
MIN_CI_WIDTH = 0.01


def median(values):
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    if n % 2 == 1:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2.0


def bootstrap_ci(samples):
    """Returns (point_estimate, ci_lo, ci_hi) where point_estimate is the
    median of the observed samples and (ci_lo, ci_hi) is the bootstrap 95% CI
    of the median.

    For N>=3 samples, does proper bootstrap resampling and enforces a minimum
    CI width (MIN_CI_WIDTH) so degenerate identical-sample cases don't produce
    zero-width intervals. For N<3, falls back to a fixed halo around the
    point estimate (FALLBACK_HALO) since bootstrap can't produce a meaningful
    distribution from 1-2 samples.
    """
    n = len(samples)
    if n == 0:
        return 0.0, 0.0, 0.0
    point = median(samples)
    if n < 3:
        halo = abs(point) * FALLBACK_HALO
        return point, point - halo, point + halo
    medians = []
    for _ in range(N_BOOTSTRAP):
        resample = [random.choice(samples) for _ in range(n)]
        medians.append(median(resample))
    medians.sort()
    lo_idx = int(N_BOOTSTRAP * (1 - CONFIDENCE) / 2)
    hi_idx = int(N_BOOTSTRAP * (1 + CONFIDENCE) / 2) - 1
    ci_lo = medians[lo_idx]
    ci_hi = medians[hi_idx]
    # Enforce minimum CI width so very-tight bootstrap results don't treat
    # sub-percent differences as statistically significant. Anything within
    # MIN_CI_WIDTH of the point estimate (per side) lands inside the CI.
    min_half_width = abs(point) * MIN_CI_WIDTH / 2
    ci_lo = min(ci_lo, point - min_half_width)
    ci_hi = max(ci_hi, point + min_half_width)
    return point, ci_lo, ci_hi


def format_value(value, metric):
    rounded = round(value, 4)
    if metric == "ms":
        return f"{rounded}ms"
    if metric in ("req/s", "msg/s"):
        return f"{int(rounded)} {metric}"
    return f"{rounded:.3f}s"


def format_ci(value, ci_lo, ci_hi, metric):
    main = format_value(value, metric)
    lo = format_value(ci_lo, metric)
    hi = format_value(ci_hi, metric)
    return f"{main} ({lo}–{hi})"


def ci_overlap(a_lo, a_hi, b_lo, b_hi):
    """Returns True if two intervals overlap (inclusive)."""
    return max(a_lo, b_lo) <= min(a_hi, b_hi)


all_benchmarks = {}
filtered_benchmarks = {}

for fname in sorted(os.listdir(json_dir)):
    if not fname.endswith(".json"):
        continue
    bkey = fname[:-5]
    filepath = os.path.join(json_dir, fname)
    results = {}
    chad_stats = None
    for line in open(filepath):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        lang, samples_csv, raw_label = parts[0], parts[1], parts[2]
        samples = []
        for s in samples_csv.split(","):
            s = s.strip()
            if not s:
                continue
            try:
                samples.append(float(s))
            except ValueError:
                pass
        if not samples:
            continue
        meta_info = META.get(bkey, {"metric": "s"})
        metric = meta_info.get("metric", "s")
        point, ci_lo, ci_hi = bootstrap_ci(samples)
        results[lang] = {
            "value": round(point, 4),
            "ci_lo": round(ci_lo, 4),
            "ci_hi": round(ci_hi, 4),
            "n": len(samples),
            "label": format_value(point, metric),
            "ci_label": format_ci(point, ci_lo, ci_hi, metric),
        }
        if lang == "chadscript":
            chad_stats = (point, ci_lo, ci_hi)

    if chad_stats is None:
        print(f"  Skipped: {bkey} (no ChadScript result)")
        continue

    meta = META.get(bkey, {"name": bkey, "desc": "", "metric": "s", "lower_is_better": True})
    lower = meta["lower_is_better"]
    is_cli = meta.get("category") == "cli"

    entry = {
        "name": meta["name"],
        "desc": meta["desc"],
        "metric": meta["metric"],
        "lower_is_better": lower,
        "results": results,
    }
    if is_cli:
        entry["category"] = "cli"

    all_benchmarks[bkey] = entry

    # Per-benchmark visibility switch. A benchmark can be excluded from the
    # published dashboard by setting `hide_from_dashboard: True` in its META
    # entry (useful when the workload doesn't measure what it claims, or the
    # story is too muddy to present). Hidden benchmarks still appear in
    # benchmarks-all.json so PR comments and reproducibility are unaffected.
    # No benchmarks currently use this — it's available for future use.
    if meta.get("hide_from_dashboard"):
        print(f"  Hidden from dashboard: {meta['name']} (kept in benchmarks-all.json)")
        continue

    # Tie-aware ranking via CI overlap. A language only counts as "ahead of
    # chad" if its 95% CI is entirely on the winning side of chad's 95% CI.
    # Overlapping CIs ⇒ not statsig different ⇒ tied.
    chad_point, chad_lo, chad_hi = chad_stats
    langs_ahead = 0
    for lang, r in results.items():
        if lang == "chadscript":
            continue
        v_point = r["value"]
        v_lo = r["ci_lo"]
        v_hi = r["ci_hi"]
        if ci_overlap(chad_lo, chad_hi, v_lo, v_hi):
            continue
        # CIs don't overlap → one is statsig ahead of the other.
        if lower:
            if v_point < chad_point:
                langs_ahead += 1
        else:
            if v_point > chad_point:
                langs_ahead += 1
    place = 1 + langs_ahead

    # No rank-based filtering — publish every benchmark that produced a
    # ChadScript result. An honest dashboard shows weaknesses too.
    entry["place"] = place
    filtered_benchmarks[bkey] = entry

ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

os.makedirs(os.path.dirname(outfile), exist_ok=True)
with open(outfile, "w") as f:
    json.dump({"timestamp": ts, "benchmarks": filtered_benchmarks}, f, indent=2)
print(f"  Wrote {len(filtered_benchmarks)} benchmarks to {outfile}")

all_outfile = outfile.replace(".json", "-all.json")
with open(all_outfile, "w") as f:
    json.dump({"timestamp": ts, "benchmarks": all_benchmarks}, f, indent=2)
print(f"  Wrote {len(all_benchmarks)} benchmarks to {all_outfile}")
