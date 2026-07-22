# Examples

Small programs in the ChadScript v2 TypeScript subset. Each is written to compile to a native
binary and produce byte-identical output to Node — run either way:

```sh
bin/chad run examples/fizzbuzz.ts   # native binary
node examples/fizzbuzz.ts           # the semantics oracle
```

- `fizzbuzz.ts` — control flow, `%`, string conversion.
- `word-count.ts` — `Map`, `split`, sorting by comparator, spread.
- `shapes.ts` — classes: inheritance, `super`, virtual override, `instanceof`.
- `data-pipeline.ts` — array `filter`/`map`/`reduce`, `Set` de-dup, object spread, closures.

These are showcases of the accepted subset — see `PLAN.md` for the language contract.
