---
layout: home
hero:
  name: ChadScript
  text: As fast as C. As safe as Rust. As ergonomic as TypeScript.
  tagline: "A natively-compiled systems language with TypeScript syntax. Write in a familiar style, ship a standalone binary with no runtime."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Why ChadScript?
      link: /why-chadscript

features:
  - title: No Runtime
    details: Compiles to standalone ELF binaries that start in under 2ms.
  - title: TypeScript Syntax
    details: Uses TypeScript's syntax — classes, interfaces, async/await, closures. Not a full TS compiler; a natively-compiled dialect.
  - title: Batteries Included
    details: Everything you'd npm install — HTTP, SQLite, fetch, crypto, JSON — is built in. No dependencies.
  - title: Single-Binary Deploy
    details: Embed HTML, CSS, and assets at compile time. Ship one file.
---

<HeroRotator />

<IRShowcase />

<HeroBenchmarks />

<ExampleTabs />

<div class="examples-link">See more <a href="/ChadScript/getting-started/quickstart">examples →</a></div>

<div class="cta-section">

## Ready to try it?

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

<div class="cta-buttons">
  <a href="/ChadScript/getting-started/installation" class="cta-button primary">Get Started</a>
  <a href="/ChadScript/why-chadscript" class="cta-button secondary">Why ChadScript?</a>
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
</style>
