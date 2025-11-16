# ChadScript Self-Hosting Plan

## Goal
Make ChadScript compile itself - specifically, compile all files in `src/` to create a native binary.

## Current Status

### What Already Works ✅
- ✅ Classes (basic support exists)
- ✅ Imports/exports
- ✅ for...of loops (INSIDE functions)
- ✅ Arrays, strings, numbers
- ✅ Try/catch (basic support)
- ✅ process.argv, process.exit
- ✅ fs module, path module
- ✅ Enums (basic)
- ✅ Maps and Sets (already implemented!)

### What's Actually Blocking ❌

**The REAL blocker**: Top-level control flow statements

Currently, the parser only allows these at the top level:
- Imports/exports
- Function/class declarations
- Variable declarations (const/let/var)
- Expression statements (function calls)

But `src/index.ts` needs:
```typescript
// This is at TOP LEVEL (not inside a function):
for (const arg of args) {  // ❌ FAILS - for loops not allowed at top level
  if (arg === '-v') {
    // ...
  }
}
```

## Simple Solution: Wrap in Main Function

Instead of implementing top-level control flow, we can modify the compiler source to use a main function pattern:

### Before (doesn't compile):
```typescript
const args = process.argv.slice(2);

for (const arg of args) {
  console.log(arg);
}
```

### After (compiles):
```typescript
function main() {
  const args = process.argv.slice(2);

  for (const arg of args) {
    console.log(arg);
  }
}

main();
```

## Implementation Steps

### Phase 1: Refactor src/index.ts (5 minutes)
1. Wrap all top-level code in a `main()` function
2. Call `main()` at the bottom
3. Test with Node to make sure it still works

### Phase 2: Try compiling (5 minutes)
```bash
npx tsx src/index.ts src/index.ts /tmp/chadscript-self-hosted
```

### Phase 3: Fix any actual missing features
Based on what errors we get, implement only what's needed:

**Likely needs:**
- Enum member access (LogLevel.Normal)
- String method: `.replace()` with regex
- path.join(), path.dirname()
- fs.existsSync(), fs.mkdirSync()

**Probably already works:**
- array.push()
- string.length
- for...of loops

## Quick Test

Let me create a minimal test of what src/index.ts actually uses:

```typescript
import * as path from 'path';
import * as fs from 'fs';

function main() {
  const args = process.argv.slice(2);

  for (const arg of args) {
    console.log(arg);
  }

  const output = path.join('.build', 'test');
  console.log(output);

  if (!fs.existsSync('.build')) {
    fs.mkdirSync('.build', { recursive: true });
  }

  process.exit(0);
}

main();
```

If this compiles, we're 90% there!

## Alternative: Add Top-Level Loops (if needed)

If we really want top-level loops, we need to modify the parser to:

1. Store top-level statements (not just skip them)
2. Add them to AST
3. Generate LLVM IR for them in a synthetic `__init` function
4. Call `__init` before main()

But the "wrap in main()" approach is simpler and cleaner!

## Next Steps

1. **Try minimal test** to see what actually fails
2. **Refactor src/index.ts** to use main() pattern
3. **Identify real blockers** from compilation errors
4. **Implement only what's needed** (not the 25 features in that doc!)

The key insight: We don't need to implement everything JavaScript has. We just need enough to compile our specific compiler source code!
