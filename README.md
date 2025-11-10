# ChadScript - AOT Compile JS to a Native Standalone Binary

## Compile your JS code
```bash
npx tsx src/index.ts file.js && ./file
```
If your code is TS, compile to JS.

TODO: Add recommended tsconfig.

## Run Tests
```bash
npm install && npm test 
```

## Bootstrap Strategy

The compiler must be transpiled to pure JavaScript (see `src-js/`). To achieve self-hosting:

1. **Transpile TypeScript → JavaScript**:
   ```bash
   npx tsc -p tsconfig.bootstrap.json
   ```
   This uses a target to avoid modern features ChadScript doesn't support (we dont want to support all JS syntax, only things we can AOT compile). If there is a way to simlify transpilation with flags to avoid constructs that are hard to parse, prefer that. We want a minimally complex compiler.

2. **Compile transpiled compiler** - Run:
   ```bash
   npx tsx src/index.ts src-js/index.js -o chadscript-bootstrap
   ```

3. **Use bootstrap compiler** once it compiles,. use the built compiler to compile files in the `tests` dir to make sure it works