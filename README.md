# ChadScript - JS to Native via LLVM

Compiles JavaScript subset → native executables (no runtime). **Goal: Self-hosting compiler**

```bash
npm install && npm test  # 20 tests, ~6s
npx tsx src/index.ts file.js && ./file
```

## Features

**Phase 1** ✅ Arithmetic, functions, calls
**Phase 2** ✅ Variables, if/while/for, comparisons, logical ops, imports/exports
**Phase 3** 🔄 Strings (literals, .length, indexing, concatenation), Arrays (literals, .length, indexing) | Next: array methods, objects, classes → self-host

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
4. [x] String concatenation (+ operator) ✅
5. [x] Arrays (literals, indexing, .length) ✅
6. [x] Array methods (.push() ✅, .map() 🚧, .join() 🚧)
7. [ ] Objects (literals, property access, methods)
8. [ ] Classes (class, constructor, this, new)
9. [ ] **Simplified self-hosting compiler** (uses above features)
10. [ ] **Full self-hosting**: Compile multi-file TypeScript compiler with itself

**Progress**: Strings & basic arrays complete! String concat with + works. Arrays support literals, indexing, .length. Next: array methods (.push, .map, .join) then objects.