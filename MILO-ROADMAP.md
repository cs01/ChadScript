# Milo Roadmap

Python-to-native compiler. Same HIR + emitter + C bridges as ChadScript v2 — only the parser and lowering layers are Python-specific.

**Benchmark:** fib(40) at C speed (0.22s vs C's 0.19s, 33x faster than CPython).

---

## Phase 0: Scaffold ✅
- [x] tree-sitter-python parser
- [x] Python AST → HIR lowering (`lower-py.ts`)
- [x] Wire up existing emitter + linker (zero changes to `emitter.ts`)
- [x] `milo build hello.py -o hello && ./hello` works

## Phase 1: Numeric Core + Strings + Lists + Classes ✅
- [x] Functions with typed params and return types
- [x] `if / elif / else`
- [x] `while` loops
- [x] `for x in range(n)` — compiler intrinsic (counted loop, no allocation)
- [x] `for x in lst` — array iteration
- [x] Arithmetic: `+ - * / % // ** << >> & | ^`
- [x] Comparisons: `== != < <= > >=`
- [x] Boolean operators: `and or not`
- [x] `int` → i64, `float` → f64 (unboxed, no NaN-boxing overhead)
- [x] String literals, f-strings, string `+`, `len()`
- [x] `list[int]` / `list[str]` literals, indexing, `append`, `len`, iteration
- [x] Classes: `__init__`, typed fields, methods, `self`, field access
- [x] Augmented assignment: `+= -= *= /= //=`
- [x] Builtins: `print`, `len`, `str`, `int`, `float`, `abs`, `bool`

**Fixtures:** arithmetic, control-flow, fib, hello, strings, lists, classes (7/7)

---

## Phase 2: Dicts + Exceptions + Closures ✅
> Unlocks most real Python programs

- [x] `dict[str, int]` / `dict[str, str]` — reuse existing map bridges
  - [x] `{}` literal, `d[k]`, `d[k] = v`, `del d[k]`
  - [ ] `.get(k)`, `.get(k, default)`
  - [x] `.keys()`, `.values()`, `.items()`
  - [x] `for k, v in d.items():`
- [x] Tuple unpacking: `a, b = (1, 2)`, `k, v = item`
- [x] `try / except / raise / finally` — reuse setjmp/longjmp bridge
  - [x] `except SomeError as e:`
  - [x] `raise ValueError("msg")`
- [ ] Nested functions + closures — reuse ChadScript closure conversion pass
- [ ] `lambda x: x + 1`
- [x] Default parameter values: `def foo(x: int = 0) -> int:`
- [ ] `None` values, nullable field types

**Fixtures:** dict-ops, exceptions, tuple-unpack ✅

---

## Phase 3: Comprehensions + More Builtins ✅
- [x] List comprehensions: `[x * 2 for x in lst if x > 0]` → desugar to loop
- [x] Dict comprehensions: `{k: v for k, v in pairs}`
- [x] `set[T]` — reuse existing set bridges
  - [x] `set()` literal, `.add()`, `.remove()`, `in` operator
  - [x] `for x in s:`
- [x] `enumerate(lst)` → yields `(i, elem)` pairs
- [x] `zip(a, b)` → parallel iteration
- [x] `sorted(lst, key=fn)`, `reversed(lst)`, `sorted(lst, reverse=True)`
- [x] `map(fn, lst)`, `filter(fn, lst)` — via `array_hof` HOF bridge
- [x] `min()`, `max()`, `sum()`, `any()`, `all()`
- [x] `range(start, stop, step)` with negative step
- [x] Multiple return values: `def foo() -> tuple[int, str]:`
- [x] `math` module: `sqrt`, `floor`, `ceil`, `pi`, `e`, trig
- [x] `lambda x: expr` — closures for HOF callbacks
- [x] `Optional[T]`, `is None`, `is not None`
- [x] `dict.get(k, default)`
- [x] Fix float printing: `3.0` should print `3.0` not `3` (Python-style repr)

**Fixtures:** comprehensions, builtins, dict-comp, set-ops, lambda-hof, range-negative ✅

---

## Phase 4: Generics ✅
> Typed collections and generic functions at C speed

- [x] `list[T]`, `dict[K, V]` with concrete type params — no boxing overhead
- [ ] `Generic[T]` classes → monomorphization (reuse ChadScript pass)
- [ ] `TypeVar` resolution at call sites
- [ ] Generic function params: `def foo(lst: list[T]) -> T:`

**Fixtures:** generic-stack ✅

---

## Phase 5: Inheritance + Protocols ✅
> Full OOP

- [x] Single inheritance: `class Dog(Animal):`
  - [x] `super().__init__()` calls
  - [x] Field layout extension (parent fields first)
  - [x] Method override
- [ ] `Protocol` (PEP 544) → vtable dispatch (reuse ChadScript interface codegen)
- [ ] `isinstance(x, T)` → vtable type-field check
- [ ] `@dataclass` → auto-generate `__init__`, `__repr__`, `__eq__`
- [ ] `@staticmethod`, `@classmethod`, `@property`

**Fixtures:** inheritance ✅

---

## Phase 6: Import System
- [x] `import math` — built-in math module via LLVM intrinsics
- [ ] `from foo import bar` — named imports from same package
- [ ] Multi-file compilation: `import mymodule`
- [ ] Python ↔ ChadScript interop: `from ./util.cs import foo` (same ABI)

---

## Phase 7: `*args` / `**kwargs` + Generators + `with` ✅ (partial)
- [x] `*args: int` → rest param → `%NumArray`
- [ ] `**kwargs: str` → runtime dict
- [ ] `yield` / generators → state machine transform (same as ChadScript async)
- [x] `with` statement → desugar (simplified: bind alias, exec body)
- [x] Walrus operator `:=`, starred unpacking `a, *rest = lst`
- [x] `sys.argv`, `sys.exit` — `py-sys-bridge.c`

---

## Phase 8: Stdlib C Bridges ✅ (partial)
- [ ] `py-io-bridge.c` — `open()`, file objects, context manager
- [x] `py-os-bridge.c` — `os.getcwd`, `os.listdir`, `os.getenv`, `os.mkdir`, `os.remove`, `os.path.exists/isfile/isdir/join/basename/dirname/abspath`
- [x] `py-sys-bridge.c` — `sys.argv`, `sys.exit`, stdio
- [ ] `py-json-bridge.c` — `json.loads` / `json.dumps` (reuse yyjson)
- [ ] `py-re-bridge.c` — `re.match`, `re.search`, `re.findall` (reuse PCRE2)
- [x] `py-random-bridge.c` — `random.random()`, `random.randint()`, `random.choice()`, `random.shuffle()`, `random.uniform()`, `random.seed()`
- [ ] `py-collections-bridge.c` — `Counter`, `defaultdict`, `deque`

**Test runner:** `node --import tsx --test tests/py-test.ts` — auto-discovers all `.py` in `tests/fixtures-py/`, diffs stdout against `python3`. **22/22 pass.**

---

## Phase 9: Numeric Computing
> numpy-like without libpython dependency

- [ ] `ndarray` type → flat f64 buffer + shape
- [ ] `py-blas-bridge.c` — wraps OpenBLAS / Accelerate
  - [ ] `dot(a, b)`, `matmul(a, b)`, element-wise ops
  - [ ] `sum`, `mean`, `std`, `min`, `max` on arrays
- [ ] TensorFlow C API bridge (`libtensorflow.so`) — no Python needed
- [ ] SIMD via LLVM auto-vectorization (free with `-O2`)

---

## Phase 10: Dynamic Types (NaN-boxing)
> Untyped Python as fallback

- [ ] `Any` → NaN-boxed f64 (reuse ChadScript NaN-box runtime)
- [ ] `Union[int, str]` → NaN-boxed
- [ ] Box insertion pass at typed/untyped boundaries
- [ ] Dynamic attribute access via runtime hash dict
- [ ] `isinstance()` → tag check

---

## Known Limitations
- `eval()` / `exec()` — incompatible with AOT, will never work
- Metaclasses — deferred indefinitely
- Arbitrary-precision `int` — i64 by default, trap on overflow; GMP opt-in later
- Float printing parity — tracked in Phase 3
- CPython extension modules (`import numpy`) — out of scope; native BLAS bridge instead
