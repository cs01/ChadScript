---
layout: home
hero:
  name: ChadScript
  text: TypeScript to Native Binaries
  tagline: "A native compiler for TypeScript — no interpreter, no runtime, no VM."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: API Reference
      link: /stdlib/

features:
  - title: No Runtime
    details: No Node.js, no V8, no interpreter. The output is a standalone ELF binary that starts in under 2ms.
  - title: Familiar Syntax
    details: Write the TypeScript you already know. Classes, interfaces, async/await, generics - it all works.
  - title: Batteries Included
    details: HTTP servers, file I/O, JSON, crypto, SQLite, regex, async - all compiled to native code. No npm required.
  - title: Zero-Cost C Interop
    details: C libraries like SQLite and OpenSSL are called directly through LLVM IR — no FFI boundary, no marshaling, no overhead. Same cost as a native function call.
---

<HeroRotator />

<HeroBenchmarks />

<IRShowcase />

<ExampleTabs />

<div class="cta-section">

## Ready to try it?

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

<div class="cta-buttons">
  <a href="/ChadScript/getting-started/installation" class="cta-button primary">Get Started →</a>
</div>

</div>

<style>
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
</style>
