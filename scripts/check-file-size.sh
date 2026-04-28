#!/bin/sh
MAX=2000
OVER=$(find src -name '*.ts' -exec awk -v max="$MAX" 'END { if (NR > max) print FILENAME ": " NR " lines (max " max ")" }' {} \;)
if [ -n "$OVER" ]; then
  echo "ERROR: .ts files over $MAX lines:"
  echo "$OVER"
  exit 1
fi
