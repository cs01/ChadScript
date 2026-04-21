#!/usr/bin/env bash
# Audit ctx.emit(`...`) sites in src/codegen/**/*.ts and classify each by the
# LLVM instruction it emits. Output JSON to stdout.
#
# Used by Step 4 (IRBuilder migration) to track bridge-coverage vs gaps.
# See memory/step4-irbuilder-design-2026-04-20.md.
set -euo pipefail

cd "$(dirname "$0")/.."

# Patterns the llvm-builder-bridge.c currently covers (keep sorted).
COVERED=(
  add alloca ashr and bitcast br br_cond call call_void
  fadd fcmp fdiv fmul fneg fptosi frem fsub
  gep icmp inttoptr load lshr mul or phi ptrtoint
  ret ret_void select sext shl sitofp srem store
  sub trunc unreachable xor zext
)

# Output: { total, by_instruction, uncovered_samples }
awk '
BEGIN {
  # Bridge-covered instructions (must match COVERED above).
  covered["add"]=1; covered["alloca"]=1; covered["ashr"]=1; covered["and"]=1
  covered["bitcast"]=1; covered["br"]=1
  covered["call"]=1
  covered["fadd"]=1; covered["fcmp"]=1; covered["fdiv"]=1; covered["fmul"]=1
  covered["fneg"]=1; covered["fptosi"]=1; covered["frem"]=1; covered["fsub"]=1
  covered["gep"]=1; covered["getelementptr"]=1
  covered["icmp"]=1; covered["inttoptr"]=1
  covered["load"]=1; covered["lshr"]=1; covered["mul"]=1
  covered["or"]=1; covered["phi"]=1; covered["ptrtoint"]=1
  covered["ret"]=1; covered["select"]=1; covered["sext"]=1
  covered["shl"]=1; covered["sitofp"]=1; covered["srem"]=1; covered["store"]=1
  covered["sub"]=1; covered["trunc"]=1; covered["unreachable"]=1
  covered["xor"]=1; covered["zext"]=1
  # Labels are handled by bb_create + bb_position in bridge.
  covered["label"]=1
}
# match ctx.emit(`...`) or this.emit(`...`) or gen.emit(`...`)
/\.emit\(`/ {
  total++
  line = $0
  # Strip up through ".emit(\`" so we see the template.
  sub(/^.*\.emit\(`/, "", line)
  # Extract first token after any "${assignee} = " prefix.
  tok = ""
  if (match(line, /^\$\{[^}]+\} = /)) {
    line = substr(line, RLENGTH + 1)
  }
  # First whitespace-delimited word is the LLVM opcode.
  n = split(line, parts, /[[:space:]]+/)
  tok = parts[1]
  # Strip trailing back-tick/paren/semicolon from the token.
  sub(/[`);].*$/, "", tok)
  # Labels end with ":" — classify separately, bridge handles via bb_create/position.
  if (tok ~ /:$/) tok = "label"
  # Normalize common variants.
  if (tok ~ /^getelementptr/) tok = "gep"
  if (tok == "") tok = "(none)"
  by_op[tok]++
  if (!(tok in covered)) {
    uncovered[tok]++
    if (uncov_sample[tok] == "") uncov_sample[tok] = FILENAME ":" FNR
  }
}
END {
  # JSON-ish output; consumers can pipe through jq.
  printf "{\n"
  printf "  \"total\": %d,\n", total
  printf "  \"by_instruction\": {\n"
  first = 1
  for (op in by_op) {
    if (!first) printf ",\n"
    first = 0
    cov = (op in covered) ? "true" : "false"
    printf "    \"%s\": { \"count\": %d, \"covered\": %s }", op, by_op[op], cov
  }
  printf "\n  },\n"
  printf "  \"uncovered_patterns\": {\n"
  first = 1
  for (op in uncovered) {
    if (!first) printf ",\n"
    first = 0
    printf "    \"%s\": { \"count\": %d, \"first_seen\": \"%s\" }", op, uncovered[op], uncov_sample[op]
  }
  printf "\n  }\n"
  printf "}\n"
}
' $(find src/codegen -name '*.ts' -not -path '*/node_modules/*')
