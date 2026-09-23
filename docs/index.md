---
layout: home
hero:
  name: ChadScript
  text: "TypeScript in, a small native binary out."
  tagline: "An ahead-of-time compiler for a statically analyzable subset of TypeScript. Every program it accepts behaves exactly like Node. Everything else is rejected at compile time with a code and a rewrite."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is accepted
      link: /reference/subset
    - theme: alt
      text: GitHub
      link: https://github.com/cs01/ChadScript/tree/main
---

<div class="status-line"><Badge type="warning" text="pre-alpha" /> The pipeline works end to end. Not for production use yet: see the <a href="/ChadScript/roadmap">roadmap</a>.</div>

<div class="stat-cards">
  <div class="stat"><div class="stat-value">128 KB</div><div class="stat-label">binary for <code>examples/shapes.ts</code></div></div>
  <div class="stat"><div class="stat-value">1.4 ms</div><div class="stat-label">to run it natively</div></div>
  <div class="stat"><div class="stat-value">42.6 ms</div><div class="stat-label">same file, <code>node --import tsx</code></div></div>
</div>
<p class="stat-note">Measured 2026-09-23 on an Apple M4 (macOS 26.6.2, Node v25.3.0) with <code>hyperfine -N</code>, 40 runs, mean. The binary is <code>bin/chad build</code> output at <code>-O2</code>, unstripped, self-contained (it links only the system C library). Wall-clock time includes process startup. <a href="/ChadScript/benchmarks">Benchmarks</a> has compute-bound numbers.</p>

<div class="home-section">

## One file, two runtimes

This is ordinary TypeScript. `node hello.ts` runs it; `bin/chad build hello.ts -o hello` compiles
it to a native executable that prints the same bytes.

<<< @/examples/hello.ts

```sh
$ bin/chad run hello.ts
```

<<< @/examples/hello.out{text}

Programs outside the subset do not compile. The rejection names the rule, the place, and a
rewrite that stays inside the subset:

<<< @/examples/rejected.ts

<<< @/examples/rejected.err{text}

</div>

<Guarantees />

<div class="home-section">

## How a program becomes a binary

</div>

<PipelineAnimation stats="native executable · no engine inside" />

<div class="home-section">

## What works today

Numbers, strings, booleans and all control flow; functions and closures (including closures
that reassign captured variables); classes with inheritance, `super`, overrides and
`instanceof`; interfaces and structural typing; unions narrowed by `typeof`, `===`,
`instanceof`, `Array.isArray` and discriminants; erased generics; arrays, `Map` and `Set`;
spread and destructuring; `try`/`catch`/`finally`; `async`/`await`, `Promise.all` and timers;
typed `JSON.parse` and `JSON.stringify`; `node:fs` (sync and promises) and `node:path`; and
multi-file ES modules, including packages that ship TypeScript source.

Not supported by design: `any`, `eval`, prototype mutation, adding or deleting properties,
CommonJS, and packages that ship only JavaScript. Those programs belong on Node, and since every
accepted program is valid TypeScript, the same file still runs there.

[Language guide](/guide/language) · [Accepted subset](/reference/subset) ·
[Error codes](/reference/errors) · [How it works](/internals/how-it-works)

</div>

<style>
.status-line {
  max-width: 760px;
  margin: 0.5rem auto 1.5rem;
  padding: 0 24px;
  text-align: center;
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
}
.status-line a {
  color: var(--vp-c-brand-1);
}
.stat-cards {
  display: flex;
  justify-content: center;
  gap: 2.5rem;
  flex-wrap: wrap;
  margin: 1rem auto 0.5rem;
  max-width: 760px;
  padding: 0 24px;
}
.stat {
  text-align: center;
  min-width: 120px;
}
.stat-value {
  font-family: var(--vp-font-family-mono);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.stat-label {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}
.stat-note {
  max-width: 760px;
  margin: 0.5rem auto 2rem;
  padding: 0 24px;
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  text-align: center;
  line-height: 1.5;
}
.stat-note a {
  color: var(--vp-c-brand-1);
}
.home-section {
  max-width: 760px;
  margin: 3rem auto 0;
  padding: 0 24px;
}
.home-section h2 {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0 0 1rem;
  border: none;
}
.home-section p {
  line-height: 1.7;
  color: var(--vp-c-text-2);
  margin: 0.75rem 0;
}
.home-section a {
  color: var(--vp-c-brand-1);
}
</style>
