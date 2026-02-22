---
layout: home
hero:
  name: ChadScript
  text: TypeScript to Native Binaries
  tagline: "A native compiler for TypeScript. Write TypeScript, ship a standalone binary."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: Learn More
      link: /language/limitations

features:
  - title: No Runtime
    details: Compiles to standalone ELF binaries that start in under 2ms.
  - title: Familiar Syntax
    details: Standard TypeScript — classes, interfaces, async/await, generics.
  - title: Batteries Included
    details: Everything you'd npm install — HTTP, SQLite, fetch, crypto, JSON — is built in. No dependencies.
  - title: Single-Binary Deploy
    details: Embed HTML, CSS, and assets at compile time. Ship one file.
---

<HeroRotator />

<IRShowcase />

<HeroBenchmarks />

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
