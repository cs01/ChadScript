# Modules and imports

Programs are directory trees of `.ts` files. The compiler starts at the entry file you give it
and compiles everything it imports into one binary. Module resolution is tsc's
(`moduleResolution: bundler`), so specifiers are written the way TypeScript already accepts
them: `./util`, `./util.js`, `./util.ts`, `./dir/index`.

::: code-group

<<< @/examples/modules/main.ts

<<< @/examples/modules/geometry.ts

<<< @/examples/modules/describe.ts

<<< @/examples/modules/units.ts

<<< @/examples/modules/constants.ts

:::

<<< @/examples/modules/main.out{text}

## What is supported

- Named imports and exports, `export { x as y }`, default exports and imports.
- Namespace imports (`import * as u from "./u"`). They compile to static references, so the
  namespace must be used as `u.name`, not passed around as a value.
- Re-exports: `export * from "./m"` and `export { x } from "./m"`.
- Type-only imports and exports (`import type`, `import { type T }`).
- Built-in modules: `node:fs`, `node:fs/promises` and `node:path`, in named, default and
  namespace forms. See [node:fs and node:path](/guide/node-modules).
- Packages in `node_modules` whose entry resolves to **TypeScript source**. They are compiled
  whole-program like your own files.

Every top-level symbol is namespaced by its module, and each module's top-level code runs once,
in dependency order, as in Node.

## What is rejected

| Form                                                  | Code                               | Instead                       |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------- |
| `require`, `module.exports`, `export =`               | [CS1226](/reference/errors#cs1226) | ESM `import` / `export`       |
| dynamic `import()`                                    | [CS1226](/reference/errors#cs1226) | a static import               |
| a package that ships only `.js` + `.d.ts`             | [CS1226](/reference/errors#cs1226) | run that program on Node      |
| using a namespace import as a value                   | [CS1226](/reference/errors#cs1226) | refer to `ns.member` directly |
| reading a module variable before its declaration runs | [CS1228](/reference/errors#cs1228) | move the declaration up       |

`node:process` as an importable module is not supported yet; use the global `process`.

Next: [Classes and interfaces](/guide/classes).
