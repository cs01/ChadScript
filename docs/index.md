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

<ExampleTabs />

<IRShowcase />
