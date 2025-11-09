# ChadScript - JS to Native via LLVM

Compiles JavaScript subset → native executables (no runtime). **Goal: Self-hosting compiler**

```bash
npm install && npm test  # 17 tests, ~5s
npx tsx src/index.ts file.js && ./file
```

## Features

**Phase 1** ✅ Arithmetic, functions, calls
**Phase 2** ✅ Variables, if/while/for, comparisons, logical ops, imports/exports
**Phase 3** 🔄 Strings (.length, indexing) | Next: concatenation, arrays, objects, classes → self-host

## Roadmap

### Phase 1: Easy Features (DONE ✅)
- [x] Basic arithmetic (+, -, *, /)
- [x] Functions and function calls
- [x] Number literals and parameters

### Phase 2: Medium Features (DONE ✅)
- [x] Local variables (let/const)
- [x] Comparison operators (<, >, <=, >=, ==, !=)
- [x] Logical operators (&&, ||, !)
- [x] If/else statements
- [x] While loops
- [x] For loops
- [x] Import/Export system (ES6 modules)
- [x] Multi-file compilation
- [x] String literals (for import paths)
- [x] String support (.length property, indexing)

### Phase 3: Bootstrap Path (IN PROGRESS)
**Goal**: Compile ChadScript compiler with itself!

**Strategy**: Incremental feature ladder
1. [x] String literals (basic - for import paths) ✅
2. [x] Import/Export system ✅
3. [x] Strings (full support: literals, .length, indexing) ✅
4. [ ] String concatenation (+ operator)
5. [ ] Arrays (literals, indexing, .length, .push(), .map(), .join())
6. [ ] Objects (literals, property access, methods)
7. [ ] Classes (class, constructor, this, new)
8. [ ] **Simplified self-hosting compiler** (uses above features)
9. [ ] **Full self-hosting**: Compile multi-file TypeScript compiler with itself

**Progress**: String support complete! Can create string literals, check .length, and index into strings. Multi-file compilation works. Next: string concatenation and arrays. Update this readme as you go. Keep it low token