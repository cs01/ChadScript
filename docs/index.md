---
layout: home
hero:
  name: ChadScript
  text: TypeScript to Native Binaries
  tagline: "Compile high-performance apps directly from TypeScript to native binaries that run as fast as C."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: API Reference
      link: /stdlib/
    - theme: alt
      text: Benchmarks
      link: /benchmarks

features:
  - title: No Runtime
    details: No Node.js, no V8, no interpreter. The output is a standalone ELF binary that starts in under 2ms.
  - title: Familiar Syntax
    details: Write the TypeScript you already know. Classes, interfaces, async/await, generics - it all works.
  - title: Batteries Included
    details: HTTP servers, file I/O, JSON, crypto, SQLite, regex, async - all compiled to native code. No npm required.
---

<HeroRotator />

## Quick Demo

```bash
$ chad build examples/hello.ts -o /tmp/hello
$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.001s
```

<ComparisonCards />

<div class="benchmark-cta">
  <a href="/benchmarks" class="benchmark-link">See benchmarks →</a>
</div>

<style>
.benchmark-cta {
  text-align: center;
  margin-top: 2rem;
}

.benchmark-link {
  display: inline-block;
  padding: 10px 28px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  color: #fff;
  background: transparent;
  border: 2px solid var(--vp-c-brand-1);
  text-decoration: none;
  transition: all 0.2s ease;
}

.benchmark-link:hover {
  color: #1a1a2e;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%);
  border-color: transparent;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);
}
</style>
