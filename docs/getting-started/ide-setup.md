# IDE Setup

Run `chad init` in your project directory to set up editor support:

```bash
chad init
```

This generates:

- `chadscript.d.ts` — type declarations for all built-in APIs
- `tsconfig.json` — configured to use the declarations for editor support
- `hello.ts` — a starter file

With these in place, VS Code (and any editor using the TypeScript language server) provides autocomplete, go-to-definition, and inline error highlighting for ChadScript's built-in APIs.

Use `chad build` to compile — `tsc` is not part of the build process.
