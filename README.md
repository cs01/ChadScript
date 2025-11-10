# ChadScript - JS to Native via LLVM

Compiles JavaScript subset → native executables (no runtime). **Goal: Self-hosting compiler**

```bash
npm install && npm test  # 20 tests, ~6s
npx tsx src/index.ts file.js && ./file
```

## Features

**Phase 1** ✅ Arithmetic, functions, calls
**Phase 2** ✅ Variables, if/else, comparisons, logical ops, imports/exports
**Phase 3** 🔄 Strings, arrays, objects, classes (basic) | **Next**: Map/Set, loops, array/string methods → self-host

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
- [x] Import/Export system (ES6 modules)
- [x] Multi-file compilation
- [x] String literals (for import paths)
- [x] String support (.length property, indexing)

### Phase 3: Bootstrap Path (IN PROGRESS)
**Goal**: Compile ChadScript compiler with itself!

**Completed** ✅
- [x] String literals, .length, indexing, concatenation
- [x] Arrays (literals, indexing, .length, .push())
- [x] Objects (literals, property access, methods)
- [x] Classes (basic: constructor, methods, this, new, field access)

**Critical Blockers** 🔴 (Required for self-hosting)
- [x] **Map/Set** - COMPLETED ✅ (new Map(), set/get/has, new Set(), add/has)
- [x] **for/while loops** - COMPLETED ✅
- [ ] **Array methods** - .find(), .some(), .filter(), .forEach()
- [ ] **String methods** - .substr() (used in parser)
- [ ] **Regex** - /pattern/.test() (used in parser)
- [ ] **Class improvements** - Multiple fields, method parameters, this.method()

**Important** 🟡 (Needed for realistic compilation)
- [ ] parseInt() function
- [ ] try/catch/throw error handling
- [ ] Arrow functions for callbacks
- [ ] Spread operator (...array)

**Nice-to-Have** 🟢 (Post-bootstrap)
- [ ] Template literals
- [ ] break/continue in loops
- [ ] Ternary operator (? :)
- [ ] External APIs (fs, process, path - need special runtime support)