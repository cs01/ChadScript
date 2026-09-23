# Build a multi-file project

Point the compiler at the entry file; it follows the imports and compiles the whole program into
one binary. Module resolution is tsc's, so write specifiers the way TypeScript accepts them:
`./stats`, `./stats.js` and `./stats.ts` all work.

## The files

::: code-group

<<< @/examples/project/main.ts

<<< @/examples/project/stats.ts

<<< @/examples/project/format.ts

:::

## Build and run

```sh
bin/chad build main.ts -o stats
./stats
```

<<< @/examples/project/main.out{text}

Node runs the same entry unchanged (`node --import tsx main.ts`) and prints the same bytes.

## Things to know

- Named, default, namespace and type-only imports all work, and so do re-exports; see
  [Modules and imports](/guide/modules) for the full list and a larger example.
- A package under `node_modules` is compiled like your own code if it ships TypeScript source.
  A package that ships only JavaScript is rejected with [CS1226](/reference/errors#cs1226).
- Top-level code in each module runs once, in dependency order, as in Node.

Next: [parse a JSON config file](/howto/json-config).
