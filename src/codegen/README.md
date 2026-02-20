# Code Generation Architecture

LLVM IR code generation for ChadScript. Main orchestrator (`LLVMGenerator`) delegates to specialized sub-generators.

## Directory Layout

```
src/codegen/
├── infrastructure/           # Core: context, symbol table, type resolver
├── expressions/              # Expression codegen (calls, access, operators)
├── statements/               # Control flow (if/while/for)
├── types/                    # Type-specific codegen
│   ├── collections/          # array, string, map, set
│   └── objects/              # class, object, regex
├── stdlib/                   # console, fs, json, math, path, process
└── llvm-generator.ts         # Main orchestrator
```

## LLVM Types

| TypeScript  | LLVM Type            | Notes           |
| ----------- | -------------------- | --------------- |
| `number`    | `double`             | All numerics    |
| `boolean`   | `double`             | 0.0 or 1.0      |
| `string`    | `i8*`                | Null-terminated |
| `number[]`  | `%Array*`            | Runtime struct  |
| `string[]`  | `%StringArray*`      | Runtime struct  |
| `Map<K,V>`  | `%Map*`              | Hash table      |
| `Set<T>`    | `%Set*`              | Hash set        |
| `ClassName` | `%ClassName_struct*` | Class instance  |

## Adding a New Method

1. Add handler in the appropriate generator (e.g., `types/collections/string.ts`)
2. Route in `expressions/method-calls.ts`
3. Add extern declaration if calling C runtime
4. Add test in `tests/fixtures/`

## Testing

```bash
npm run test:fast              # Quick smoke tests
npm test -- --test-name-pattern="Array"  # Category tests
```
