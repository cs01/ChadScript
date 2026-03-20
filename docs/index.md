---
layout: home
hero:
  name: ChadScript
  text: "TypeScript, compiled to native code."
  tagline: "A compiler that takes a statically analyzable subset of TypeScript and generates optimized machine code via LLVM — the same backend behind C, Rust, and Swift."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Learn More
      link: /language/features

features:
  - title: Native Speed
    details: Compiles to native CPU code via LLVM — the same compiler backend used by C, Rust, and Swift. No V8, no JIT warmup, no garbage collection pauses.
  - title: TypeScript Syntax
    details: Write the TypeScript you already know — classes, generics, interfaces, async/await, closures, JSX. No new language to learn.
  - title: Batteries Included
    details: No package manager, no dependencies. HTTP server, SQLite, fetch, crypto, WebSocket, JSON — all built into the standard library. Write code, run it.
  - title: Single-Binary Deploy
    details: The output is a standalone native binary — no runtime, no node_modules, no bundler. Copy it to a server, drop it in a Docker scratch image, run it anywhere.
---

<HeroRotator />

<div class="stat-cards">
  <div class="stat"><div class="stat-value">0.8ms</div><div class="stat-label">cold start</div></div>
  <div class="stat"><div class="stat-value">~250KB</div><div class="stat-label">binary size</div></div>
  <div class="stat"><div class="stat-value">621+</div><div class="stat-label">tests passing</div></div>
  <div class="stat"><div class="stat-value">self-hosting</div><div class="stat-label">compiles itself</div></div>
</div>

<PipelineAnimation />

<div class="story-section">
<h2 class="story-heading">It's Fast.</h2>
<p class="story-body">Your code goes through the same LLVM optimization passes as C and Rust. No interpreter, no JIT warmup, no virtual machine overhead. The binary starts in under a millisecond and runs at native speed.</p>

| Benchmark | ChadScript | Node.js | vs Node | C |
|---|---|---|---|---|
| Cold Start | **0.6ms** | 21.8ms | **36x** | 0.6ms |
| Monte Carlo Pi | **0.398s** | 1.474s | **3.7x** | 0.400s |
| File I/O | **0.089s** | 0.315s | **3.5x** | 0.088s |
| JSON Parse | **0.005s** | 0.015s | **3.0x** | 0.004s |
| Fibonacci | **1.424s** | 2.842s | **2.0x** | 0.725s |
| N-Body Sim | **1.852s** | 2.296s | **1.2x** | 1.453s |

<p class="story-link"><a href="/ChadScript/benchmarks">Full benchmarks →</a></p>
</div>

<div class="story-section">
<h2 class="story-heading">It's Familiar.</h2>
<p class="story-body">No new syntax to learn. If you write TypeScript, you already know ChadScript.</p>

<div class="evidence-grid">
<div class="evidence-col">
<div class="evidence-item">Classes & inheritance</div>
<div class="evidence-item">Interfaces & type aliases</div>
<div class="evidence-item">Generics</div>
<div class="evidence-item">async / await</div>
<div class="evidence-item">Closures</div>
<div class="evidence-item">Destructuring & spread</div>
<div class="evidence-item">Template literals</div>
</div>
<div class="evidence-col">
<div class="evidence-item">Arrow functions</div>
<div class="evidence-item">for...of / for...in</div>
<div class="evidence-item">Map, Set, Uint8Array</div>
<div class="evidence-item">Promise.all / .race</div>
<div class="evidence-item">JSX</div>
<div class="evidence-item">Modules & imports</div>
<div class="evidence-item">try / catch / finally</div>
</div>
</div>
</div>

<div class="story-code">

```typescript
import { httpServe, Router, Context } from "chadscript/http";

const app: Router = new Router();
app.get("/", (c: Context) => c.json({ hello: "world" }));
httpServe(3000, (req: HttpRequest) => app.handle(req));
```

<div class="code-caption">A complete HTTP server. <code>chad build app.ts</code> → 247KB binary, 0.8ms startup.</div>
</div>

<div class="story-section">
<h2 class="story-heading">It's Friendly.</h2>
<p class="story-body">No package manager. No <code>node_modules</code>. Everything ships with the compiler.</p>

<div class="stdlib-grid">
<div class="stdlib-item"><span class="stdlib-name">HTTP server</span><span class="stdlib-api">Router, httpServe, WebSocket</span></div>
<div class="stdlib-item"><span class="stdlib-name">SQLite</span><span class="stdlib-api">open, query, exec, transactions</span></div>
<div class="stdlib-item"><span class="stdlib-name">fetch</span><span class="stdlib-api">GET, POST, headers, JSON</span></div>
<div class="stdlib-item"><span class="stdlib-name">crypto</span><span class="stdlib-api">SHA-256, HMAC, randomBytes</span></div>
<div class="stdlib-item"><span class="stdlib-name">fs</span><span class="stdlib-api">read, write, stat, readdir</span></div>
<div class="stdlib-item"><span class="stdlib-name">JSON</span><span class="stdlib-api">parse&lt;T&gt;, stringify</span></div>
<div class="stdlib-item"><span class="stdlib-name">child_process</span><span class="stdlib-api">execSync, spawnSync</span></div>
<div class="stdlib-item"><span class="stdlib-name">RegExp</span><span class="stdlib-api">test, match, replace</span></div>
<div class="stdlib-item"><span class="stdlib-name">path</span><span class="stdlib-api">join, resolve, dirname</span></div>
<div class="stdlib-item"><span class="stdlib-name">process</span><span class="stdlib-api">argv, env, exit, cwd</span></div>
</div>

<p class="story-body" style="margin-top: 1rem;">In production today: <a href="https://chadsmith.dev/hn">chadsmith.dev/hn</a> and <a href="https://chadsmith.dev/weather">chadsmith.dev/weather</a> — both running as single ChadScript binaries.</p>
</div>

<div class="bottom-cta">

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

<div class="cta-buttons">
  <a href="/ChadScript/getting-started/installation" class="cta-button primary">Get Started</a>
  <a href="/ChadScript/stdlib/" class="cta-button secondary">Standard Library</a>
</div>

<p class="cta-note">ChadScript compiles a subset of TypeScript — not a drop-in replacement. <a href="/ChadScript/language/features">See what's supported →</a></p>

</div>

<style>
.story-section {
  max-width: 640px;
  margin: 3.5rem auto;
  padding: 0 24px;
}

.story-heading {
  font-size: 3rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin-bottom: 0.75rem;
  border: none;
}

.story-body {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  line-height: 1.7;
  margin-bottom: 0.5rem;
}

.story-body code {
  font-size: 0.9rem;
  color: var(--vp-c-text-1);
}

.story-body a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.story-body a:hover {
  text-decoration: underline;
}

.story-link {
  margin-top: 0.5rem;
  font-size: 0.88rem;
}

.story-link a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.story-link a:hover {
  text-decoration: underline;
}

.story-section table {
  font-size: 0.9rem;
  margin-top: 1rem;
}

.evidence-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 2rem;
  margin-top: 1rem;
}

.evidence-item {
  font-size: 0.92rem;
  color: var(--vp-c-text-1);
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.stdlib-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 2rem;
  margin-top: 1rem;
}

.stdlib-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.stdlib-name {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--vp-c-text-1);
}

.stdlib-api {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

@media (max-width: 640px) {
  .evidence-grid, .stdlib-grid {
    grid-template-columns: 1fr;
  }
}

.story-code {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 24px;
}

.code-caption {
  max-width: 640px;
  margin: -0.5rem auto 0;
  padding: 0 24px;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  text-align: center;
}

.code-caption code {
  font-size: 0.82rem;
  color: var(--vp-c-text-1);
}

.stat-cards {
  display: flex;
  justify-content: center;
  gap: 2rem;
  flex-wrap: wrap;
  margin: 1rem auto 2.5rem;
  max-width: 640px;
  padding: 0 24px;
}

.stat {
  text-align: center;
  min-width: 100px;
}

.stat-value {
  font-family: var(--vp-font-family-mono);
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.stat-label {
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}

.production-bar {
  max-width: 700px;
  margin: 2.5rem auto;
  padding: 0 24px;
  text-align: center;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.production-bar a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.production-bar a:hover {
  text-decoration: underline;
}

.bottom-cta {
  max-width: 688px;
  margin: 1rem auto 2rem;
  padding: 0 1.5rem;
  text-align: center;
}

.bottom-cta .language-bash {
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

.cta-button:hover { opacity: 0.85; }

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

.cta-note {
  margin-top: 1.5rem;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
}

.cta-note a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.cta-note a:hover {
  text-decoration: underline;
}
</style>
