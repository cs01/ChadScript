#!/usr/bin/env bash
start_ns=$(date +%s%N)
matches=$(grep -r "console.log" src/ | wc -l)
end_ns=$(date +%s%N)
elapsed_ns=$((end_ns - start_ns))
elapsed_s=$(echo "scale=3; $elapsed_ns / 1000000000" | bc)
echo "Matches:  $matches"
echo "Time:     ${elapsed_s}s"
