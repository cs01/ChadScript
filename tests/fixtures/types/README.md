# ChadScript Global Types

This directory contains TypeScript type definitions for ChadScript's built-in runtime APIs.

## What's Included

### Namespaces

- **`fs`** - File system operations (readFileSync, writeFileSync, existsSync, unlinkSync)
- **`console`** - Console output (log, error)
- **`process`** - Process utilities (exit, argv)
- **`Math`** - Mathematical operations (sqrt, pow, floor, ceil, round, abs)
- **`JSON`** - JSON operations (parse, stringify)
- **`path`** - Path utilities (resolve, dirname)

### Global Functions

- **`parseInt(str, radix?)`** - Parse strings to integers
- **`malloc(size)`** / **`free(ptr)`** - Manual memory management
- **`socket(...)`**, **`bind(...)`**, **`listen(...)`**, **`accept(...)`** - Socket operations
- **`read(...)`**, **`write(...)`**, **`close(...)`** - Low-level I/O
- **`htons(value)`** - Network byte order conversion

## How It Works

VS Code and other TypeScript-aware editors will automatically pick up these type definitions when you open `.ts` or `.js` files in the `tests/fixtures` directory. You'll get:

- ✅ Autocomplete for all ChadScript built-ins
- ✅ Type checking (e.g., `fs.readFileSync()` expects a string)
- ✅ Inline documentation (hover over functions to see docs)
- ✅ No "Cannot find name 'fs'" errors

## Example

```typescript
// This will have full type support in VS Code!
interface Config {
  host: string;
  port: number;
}

function readConfig(): string {
  const content = fs.readFileSync("config.json");
  const parsed = JSON.parse<Config>(content);
  console.log("Config loaded");
  return content;
}
```

## Adding New Built-ins

When you add new built-in functions to ChadScript:

1. Add the implementation in `src/codegen/stdlib/`
2. Add the type definition in `tests/fixtures/types/chadscript-globals.d.ts`
3. VS Code will immediately recognize the new function!

## Notes

- These types are separate from the compiler's own types (in `src/`)
- The compiler uses full Node.js types, while ChadScript programs use these limited runtime types
- The `tsconfig.json` in this directory configures TypeScript to use these types
