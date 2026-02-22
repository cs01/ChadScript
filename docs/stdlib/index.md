# Standard Library

Everything is built in. No `npm install`, no `node_modules`, no bundler. All APIs are available as globals — no imports needed.

API names match Node.js where applicable (`fs.readFileSync`, `process.argv`, `path.join`, `console.log`, etc.), so the code you write looks like standard TypeScript. The main difference is that these APIs compile to native code instead of calling into V8.

Browse the sidebar for the full API reference.

## Editor Support

Run `chad init` in your project directory to generate type definitions for your editor:

```bash
chad init
```

This creates:
- **`chadscript.d.ts`** — type declarations for all built-in APIs so your editor provides autocomplete and type checking
- **`tsconfig.json`** — configured for ChadScript's supported TypeScript subset
- **`hello.ts`** — a starter file

Your editor (VS Code, etc.) will immediately recognize all ChadScript globals without any red squiggles.
