#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
CLI="node --import tsx src/cli.ts"
SUBS="--substitute src/parser.ts=src/parser-bridge.ts --substitute src/codegen/llvm.ts=src/codegen/llvm-text.ts"
OUT_DIR=$(mktemp -d)
trap "rm -rf $OUT_DIR; rm -f .bisect-probe-*.ts" EXIT

pass=0
fail=0
first_fail=""

run_probe() {
  local name="$1"
  local file="$2"
  if $CLI build "$file" --emit-ir $SUBS -o "$OUT_DIR/${name}" 2>"$OUT_DIR/${name}.err"; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    local err=$(head -1 "$OUT_DIR/${name}.err")
    echo "  FAIL  $name — $err"
    fail=$((fail + 1))
    if [ -z "$first_fail" ]; then first_fail="$name"; fi
  fi
}

echo "=== Self-Host Bisect ==="
echo ""

# Level 0: errors.ts
cat > .bisect-probe-L0.ts << 'EOF'
import { CompileError, setSourceContext } from "./src/errors.js";
const e = new CompileError("test");
console.log(e.format());
EOF
echo "Level 0: errors.ts"
run_probe "L0" ".bisect-probe-L0.ts"

# Level 1: hir/types.ts (type-only)
cat > .bisect-probe-L1.ts << 'EOF'
import type { HIRModule } from "./src/hir/types.js";
console.log("ok");
EOF
echo "Level 1: hir/types (type-only)"
run_probe "L1" ".bisect-probe-L1.ts"

# Level 2: each transform
echo "Level 2: transforms"
cat > .bisect-probe-L2a.ts << 'EOF'
import { constFoldPass } from "./src/transforms/const-fold.js";
console.log("ok");
EOF
cat > .bisect-probe-L2b.ts << 'EOF'
import { deadCodePass } from "./src/transforms/dead-code.js";
console.log("ok");
EOF
cat > .bisect-probe-L2c.ts << 'EOF'
import { narrowFpPass } from "./src/transforms/narrow-fp.js";
console.log("ok");
EOF
cat > .bisect-probe-L2d.ts << 'EOF'
import { narrowFnsPass } from "./src/transforms/narrow-fns.js";
console.log("ok");
EOF
cat > .bisect-probe-L2e.ts << 'EOF'
import { narrowLocalsPass } from "./src/transforms/narrow-locals.js";
console.log("ok");
EOF
cat > .bisect-probe-L2f.ts << 'EOF'
import { narrowGlobalsPass } from "./src/transforms/narrow-globals.js";
console.log("ok");
EOF
cat > .bisect-probe-L2g.ts << 'EOF'
import { concatBuilderPass } from "./src/transforms/concat-builder.js";
console.log("ok");
EOF
cat > .bisect-probe-L2h.ts << 'EOF'
import { arenifyLoopsPass } from "./src/transforms/arenify-loops.js";
console.log("ok");
EOF
run_probe "L2a-const-fold" ".bisect-probe-L2a.ts"
run_probe "L2b-dead-code" ".bisect-probe-L2b.ts"
run_probe "L2c-narrow-fp" ".bisect-probe-L2c.ts"
run_probe "L2d-narrow-fns" ".bisect-probe-L2d.ts"
run_probe "L2e-narrow-locals" ".bisect-probe-L2e.ts"
run_probe "L2f-narrow-globals" ".bisect-probe-L2f.ts"
run_probe "L2g-concat-builder" ".bisect-probe-L2g.ts"
run_probe "L2h-arenify-loops" ".bisect-probe-L2h.ts"

# Level 3: HIR lowering
cat > .bisect-probe-L3.ts << 'EOF'
import { lowerModule } from "./src/hir/lower.js";
console.log("ok");
EOF
echo "Level 3: HIR lowering"
run_probe "L3" ".bisect-probe-L3.ts"

# Level 4: codegen emitter
cat > .bisect-probe-L4.ts << 'EOF'
import { emitModule } from "./src/codegen/emitter.js";
console.log("ok");
EOF
echo "Level 4: codegen emitter"
run_probe "L4" ".bisect-probe-L4.ts"

# Level 5: resolver
cat > .bisect-probe-L5.ts << 'EOF'
import { resolveModules } from "./src/resolver.js";
console.log("ok");
EOF
echo "Level 5: resolver"
run_probe "L5" ".bisect-probe-L5.ts"

# Level 6: compiler
cat > .bisect-probe-L6.ts << 'EOF'
import { compile } from "./src/compiler.js";
console.log("ok");
EOF
echo "Level 6: compiler"
run_probe "L6" ".bisect-probe-L6.ts"

# Level 7: full cli
echo "Level 7: full cli.ts"
run_probe "L7" "src/cli.ts"

echo ""
echo "=== Summary: $pass passed, $fail failed ==="
if [ -n "$first_fail" ]; then
  echo "First failure: $first_fail"
fi
