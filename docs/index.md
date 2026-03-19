---
layout: home
hero:
  name: ChadScript
  text: TypeScript that compiles to native binaries.
  tagline: "Sub-millisecond startup. ~250KB binaries. No runtime. No dependencies."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: What is ChadScript?
      link: /why-chadscript

features:
  - title: Native Speed
    details: Compiles to optimized machine code. Same optimization passes used by C and Rust compilers.
  - title: TypeScript Syntax
    details: Classes, generics, interfaces, async/await, closures, JSX. If you write TypeScript, you already know ChadScript.
  - title: Batteries Included
    details: No package manager, no dependencies. HTTP server, SQLite, fetch, crypto, WebSocket, JSON — all built into the standard library. Write code, run it.
  - title: Single-Binary Deploy
    details: One file, no dependencies. Copy it to a server, drop it in a Docker scratch image, run it anywhere.
---

<HeroRotator />

<IRShowcase />

<HeroBenchmarks />

<ExampleTabs />

<div class="examples-link">See more <a href="/ChadScript/getting-started/quickstart">examples</a></div>

<div class="landing-content">

## What's Included

No package manager, no `node_modules`. Everything compiles into your binary.

| Module | Key APIs |
|--------|----------|
| **console** | `log`, `error`, `warn` |
| **fs** | `readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`, `readdirSync`, `statSync` |
| **JSON** | `parse<T>`, `stringify` |
| **fetch** | `fetch(url, { method, headers, body })` → Response with `.text()`, `.status`, `.headers` |
| **HTTP server** | `Router`, `httpServe`, `Context`, WebSocket support |
| **SQLite** | `open`, `exec`, `all`, `get`, `close` |
| **crypto** | `sha256`, `md5`, `randomBytes`, `randomUUID` |
| **child_process** | `execSync`, `spawnSync` |
| **Map, Set** | Full `Map<K,V>` and `Set<T>` with typed keys/values |
| **path** | `join`, `dirname`, `basename`, `resolve` |
| **Math, Date** | Standard APIs |
| **RegExp** | `test`, `match`, `replace` |
| **process** | `argv`, `env`, `exit`, `cwd`, `stdin.read()` |
| **os** | `platform`, `arch`, `hostname`, `homedir` |
| **ArgumentParser** | CLI arg parsing (`import from chadscript/argparse`) |
| **URL, URLSearchParams** | URL parsing and query string handling |
| **btoa, atob** | Base64 and `encodeURIComponent` encoding utilities |

<a href="/ChadScript/stdlib/" class="section-link">Full standard library docs →</a>

## Language Support

<div class="feature-columns">
<div class="feature-col">

**Supported**

- `let`/`const`, `if`/`else`, `for`/`while`/`switch`
- `try`/`catch`/`finally`, `throw`
- Arrow functions, `async`/`await`
- Classes with inheritance and `implements`
- Generics (`class Stack<T>`, `function identity<T>`)
- Interfaces and type aliases
- Destructuring, spread, rest params
- Template literals, closures, modules
- JSX (desugared to `createElement` calls)
- RegExp, `for...of`, `for...in`
- `Map<K,V>`, `Set<T>`, `Uint8Array`
- `Promise.all`, `.race`, `.allSettled`
- Default and rest parameters

</div>
<div class="feature-col">

**Not Supported**

- `any`, `unknown`, `never`
- `eval`, `Proxy`, `Reflect`
- Runtime `instanceof`
- Dynamic `import()`
- Generators, decorators
- `WeakMap`, `WeakSet`, `Symbol`
- Intersection / mapped / conditional types
- Closures capture by value (not by reference)
- Union types limited to nullable (`T | null`)

</div>
</div>

<a href="/ChadScript/language/features" class="section-link">Full feature reference →</a>

## What ChadScript Is Not

ChadScript is a statically-typed subset of TypeScript designed for native compilation. It is not a JavaScript runtime. There is no `any`, no `eval`, no runtime type inspection, no dynamic imports. npm packages won't work unless rewritten in the ChadScript subset. If you need full Node.js compatibility, use Node, Bun, or Deno. ChadScript is for when you want a native binary.

## In Production

[chadsmith.dev/hn](https://chadsmith.dev/hn) — a live Hacker News clone running as a ChadScript binary: SQLite database, HTTP server, and embedded HTML/CSS/JS assets, shipped as a single file. [chadsmith.dev/weather](https://chadsmith.dev/weather) — a weather dashboard built the same way.

</div>

<div class="cta-section">

## Ready to try it?

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

<div class="cta-buttons">
  <a href="/ChadScript/getting-started/installation" class="cta-button primary">Get Started</a>
  <a href="/ChadScript/why-chadscript" class="cta-button secondary">What is ChadScript?</a>
</div>

</div>

<style>
.examples-link {
  text-align: center;
  margin-top: 1rem;
  font-size: 0.9rem;
  color: var(--vp-c-text-3);
}
.examples-link a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.examples-link a:hover {
  text-decoration: underline;
}
.cta-section {
  max-width: 688px;
  margin: 4rem auto 2rem;
  padding: 0 1.5rem;
  text-align: center;
}
.cta-section h2 {
  font-size: 1.8rem;
  margin-bottom: 1rem;
}
.cta-section .language-bash {
  text-align: left;
}
.cta-buttons {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 1.5rem;
}
.cta-button {
  padding: 0.6rem 1.4rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  transition: opacity 0.2s;
}
.cta-button:hover {
  opacity: 0.85;
}
.cta-button.primary {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--vp-c-text-1);
}
.cta-button.primary:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  opacity: 1;
}
.cta-button.secondary {
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}
.landing-content {
  max-width: 768px;
  margin: 3rem auto;
  padding: 0 1.5rem;
}
.landing-content h2 {
  font-size: 1.5rem;
  margin-top: 3rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 0.5rem;
}
.landing-content h2:first-child {
  margin-top: 0;
}
.landing-content table {
  width: 100%;
  font-size: 0.9rem;
}
.landing-content p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}
.section-link {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.section-link:hover {
  text-decoration: underline;
}
.feature-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}
@media (max-width: 640px) {
  .feature-columns {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
.feature-col ul {
  padding-left: 1.2rem;
  font-size: 0.9rem;
  line-height: 1.8;
}
.feature-col strong {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
}
</style>
