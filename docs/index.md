---
layout: home
hero:
  name: ChadScript
  text: "TypeScript, compiled to native code."
  tagline: "Ties hand-written C on real workloads. 250KB binaries. 0.8ms cold start. No runtime, no node_modules. Same LLVM backend as C, Rust, and Swift."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Benchmarks
      link: /benchmarks

features:
  - title: Native Speed
    details: Compiles to native CPU code via LLVM — same backend as C, Rust, and Swift. No V8, no JIT warmup.
  - title: TypeScript Syntax
    details: Classes, generics, interfaces, async/await, closures, JSX. The TypeScript you already write.
  - title: Batteries Included
    details: HTTP, SQLite, fetch, crypto, WebSocket, JSON — built-in. No package manager, no dependencies.
  - title: Single-Binary Deploy
    details: Standalone native binary. Drop into a Docker scratch image. No runtime, no node_modules.
---

<HeroRotator />

<div class="stat-cards">
  <div class="stat"><div class="stat-value">0.8ms</div><div class="stat-label">cold start</div></div>
  <div class="stat"><div class="stat-value">~250KB</div><div class="stat-label">binary size</div></div>
  <div class="stat"><div class="stat-value">621+</div><div class="stat-label">tests passing</div></div>
  <div class="stat"><div class="stat-value">self-hosting</div><div class="stat-label">compiles itself</div></div>
</div>

<div class="audience-bar">
<div class="audience-item"><b>CLI tools.</b> Like Go, but TypeScript.</div>
<div class="audience-item"><b>Backends.</b> Like Bun, but compiled.</div>
<div class="audience-item"><b>Serverless / edge.</b> 0.8ms cold start.</div>
</div>

<PipelineAnimation />

<div class="story-section">
<h2 class="story-heading">It ties C.</h2>
<p class="story-body">Same LLVM optimization passes as C and Rust. No interpreter, no JIT warmup. Each row shows ChadScript's time as a fraction of Node's.</p>

<div class="bench-bars">
  <div class="bench-row">
    <div class="bench-name">Monte Carlo Pi</div>
    <div class="bench-track">
      <div class="bench-seg chad" style="width: 11%"><span>0.279s</span></div>
      <div class="bench-seg other" style="width: 89%"><span>Node 2.564s</span></div>
    </div>
    <div class="bench-mult">9.2× faster</div>
  </div>
  <div class="bench-row">
    <div class="bench-name">Cold Start</div>
    <div class="bench-track">
      <div class="bench-seg chad" style="width: 20%"><span>5.8ms</span></div>
      <div class="bench-seg other" style="width: 80%"><span>Node 28.9ms</span></div>
    </div>
    <div class="bench-mult">5.0× faster</div>
  </div>
  <div class="bench-row">
    <div class="bench-name">SQLite</div>
    <div class="bench-track">
      <div class="bench-seg chad" style="width: 45%"><span>0.076s</span></div>
      <div class="bench-seg other" style="width: 55%"><span>Node 0.169s</span></div>
    </div>
    <div class="bench-mult">2.2× faster</div>
  </div>
  <div class="bench-row">
    <div class="bench-name">JSON Parse</div>
    <div class="bench-track">
      <div class="bench-seg chad" style="width: 50%"><span>0.002s</span></div>
      <div class="bench-seg other" style="width: 50%"><span>Node 0.004s</span></div>
    </div>
    <div class="bench-mult">2.0× faster</div>
  </div>
</div>

<p class="story-link"><a href="/ChadScript/benchmarks">Full benchmarks (14 workloads, 95% bootstrap CIs) →</a></p>
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

<div class="bottom-cta">

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

<div class="cta-buttons">
  <a href="/ChadScript/getting-started/installation" class="cta-button primary">Get Started</a>
  <a href="/ChadScript/stdlib/" class="cta-button secondary">Standard Library</a>
</div>

<p class="cta-note">In production at <a href="https://chadsmith.dev/weather">chadsmith.dev/weather</a> and <a href="https://chadsmith.dev/hn">chadsmith.dev/hn</a>. Compiles a subset of TypeScript — <a href="/ChadScript/language/features">see what's supported</a>.</p>

</div>

<style>
.story-section {
  max-width: 720px;
  margin: 3rem auto;
  padding: 0 24px;
}

.story-heading {
  font-size: 2.4rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  margin-bottom: 0.5rem;
  border: none;
}

.story-body {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin-bottom: 1rem;
}

.story-link {
  margin-top: 1rem;
  font-size: 0.85rem;
}

.story-link a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.story-code {
  max-width: 720px;
  margin: 0 auto 3rem;
  padding: 0 24px;
}

.code-caption {
  margin-top: -0.25rem;
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
  gap: 2.5rem;
  flex-wrap: wrap;
  margin: 1rem auto 1.5rem;
  max-width: 720px;
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

.audience-bar {
  max-width: 720px;
  margin: 0 auto 2rem;
  padding: 0 24px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.audience-item {
  padding: 0.5rem 0;
  text-align: center;
  border-top: 1px solid var(--vp-c-divider);
}

.audience-item b {
  color: var(--vp-c-text-1);
  margin-right: 0.4rem;
}

@media (max-width: 720px) {
  .audience-bar { grid-template-columns: 1fr; gap: 0; }
}

.bench-bars {
  font-family: var(--vp-font-family-mono);
}

.bench-row {
  display: grid;
  grid-template-columns: 130px 1fr 100px;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.bench-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.bench-track {
  display: flex;
  height: 26px;
  background: rgba(255,255,255,0.04);
  border-radius: 5px;
  overflow: hidden;
}

.bench-seg {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
}

.bench-seg.chad {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-weight: 700;
}

.bench-seg.chad span {
  padding: 0 0.6rem;
}

.bench-seg.other {
  background: rgba(140,140,140,0.3);
  color: var(--vp-c-text-2);
}

.bench-seg.other span {
  padding: 0 0.6rem;
  margin-left: auto;
}

.bench-mult {
  text-align: right;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

@media (max-width: 720px) {
  .bench-row { grid-template-columns: 100px 1fr 80px; gap: 0.5rem; }
  .bench-seg { font-size: 0.7rem; }
}

.bottom-cta {
  max-width: 688px;
  margin: 1rem auto 3rem;
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
}

.cta-button.primary {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--vp-c-text-1);
}

.cta-button.secondary {
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.cta-note {
  margin-top: 1.5rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.cta-note a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
</style>
