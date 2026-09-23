---
layout: home
hero:
  name: ChadScript
  text: Ship TypeScript as a tiny native program.
  tagline: "ChadScript compiles ordinary TypeScript into one small executable that starts instantly. If it compiles, it prints exactly what Node would. If it can't promise that, it tells you why and how to fix it."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/cs01/ChadScript
---

<div class="stat-cards">
  <div class="stat"><div class="stat-value">128 KB</div><div class="stat-label">the whole program, no runtime to install</div></div>
  <div class="stat"><div class="stat-value">1.4 ms</div><div class="stat-label">to start and run</div></div>
  <div class="stat"><div class="stat-value">42.6 ms</div><div class="stat-label">the same file on Node</div></div>
</div>
<p class="stat-note">Measured on <code>examples/shapes.ts</code>, Apple M4, 2026-09-23, mean of 40 runs, startup included. <a href="/ChadScript/benchmarks">More benchmarks</a>, including where Node is still faster.</p>

<div class="home-section">

## Your TypeScript, as a native program

No new language and no annotations. This is a plain `.ts` file:

<<< @/examples/hello.ts

```sh
$ bin/chad build hello.ts -o orders
$ ./orders
```

<<< @/examples/hello.out{text}

Run the same file with Node and you get the same bytes. That is the promise.

</div>

<div class="home-section">

## No silent surprises

ChadScript knows the shape of every object when the program is compiled, which is a big part of
why the binary is small and fast. Code that would change an object's shape later is stopped
before it ships, with a message that points at the line and says how to fix it:

<<< @/examples/rejected-shape.ts

<<< @/examples/rejected-shape.err{text}

Declare the property up front and it compiles, and prints what Node prints:

<<< @/examples/fixed-shape.ts{6}

<<< @/examples/fixed-shape.out{text}

A program either behaves exactly like Node or does not compile. There is no third outcome.

</div>

<div class="home-section">

## Why try it

<div class="cards">
  <div class="card">
    <h3>Small and instant</h3>
    <p>One self-contained executable, about 130 KB for a small program. It starts in about a millisecond: no engine to boot and no warm-up. Copy it to a machine without Node and run it.</p>
  </div>
  <div class="card">
    <h3>Same results as Node</h3>
    <p>More than 380 test programs are run with Node and as native binaries on every change, and any difference in output fails the build. Fuzzers add over 100 generated programs to every run.</p>
  </div>
  <div class="card">
    <h3>The TypeScript you already write</h3>
    <p>Modules and imports, classes, interfaces, unions, generics, closures, <code>Map</code> and <code>Set</code>, <code>async</code>/<code>await</code>, typed <code>JSON.parse</code>, <code>node:fs</code> and <code>node:path</code>.</p>
  </div>
</div>

</div>

<div class="home-section">

## Is it for you?

<div class="fit">
  <div>
    <h3>A good fit today</h3>
    <ul>
      <li>Command-line tools you want to hand someone as a single file</li>
      <li>Scripts and jobs where startup time matters</li>
      <li>Data processing with files, JSON, maps and classes</li>
      <li>Learning how TypeScript maps to machine code</li>
    </ul>
  </div>
  <div>
    <h3>Not yet</h3>
    <ul>
      <li>npm packages that ship only JavaScript</li>
      <li><code>any</code>, <code>eval</code>, and adding properties at runtime</li>
      <li>Browser APIs, HTTP servers and sockets</li>
      <li>Anything in production: this is pre-alpha</li>
    </ul>
  </div>
</div>

When ChadScript says no, your code is still valid TypeScript, so the same file runs on Node.
See the [full list of what works](/reference/subset) and the [limitations](/roadmap).

</div>

<div class="home-section">

## Try it in a few minutes

You need [bun](https://bun.sh), clang and git.

```sh
git clone https://github.com/cs01/ChadScript.git && cd ChadScript
bun install && sh scripts/setup-milo.sh
bin/chad run examples/word-count.ts
```

**Next:** the [getting started guide](/guide/getting-started) builds a multi-file program, then
the [language guide](/guide/language) shows what you can write.

</div>

<div class="home-section closing">

ChadScript is pre-alpha and developed in the open. If you find a program that compiles but prints
something different from Node, that is the most important kind of bug:
[please open an issue](https://github.com/cs01/ChadScript/issues/new). Curious how it works?
Read [how it works](/internals/how-it-works) or see the [roadmap](/roadmap).

</div>

<style>
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
  min-width: 140px;
}
.stat-value {
  font-family: var(--vp-font-family-mono);
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.stat-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-top: 2px;
}
.stat-note {
  max-width: 760px;
  margin: 0.5rem auto 1rem;
  padding: 0 24px;
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  text-align: center;
  line-height: 1.5;
}
.stat-note a,
.home-section a {
  color: var(--vp-c-brand-1);
}
.home-section {
  max-width: 760px;
  margin: 3.5rem auto 0;
  padding: 0 24px;
}
.home-section h2 {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0 0 1rem;
  border: none;
  padding-top: 0;
}
.home-section p {
  line-height: 1.7;
  color: var(--vp-c-text-2);
  margin: 0.75rem 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1rem;
}
.card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 1rem 1.1rem;
  background: var(--vp-c-bg-soft);
}
.card h3,
.fit h3 {
  font-size: 1.05rem;
  margin: 0 0 0.4rem;
}
.card p {
  font-size: 0.92rem;
  margin: 0;
}
.fit {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.5rem;
}
.fit ul {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--vp-c-text-2);
  line-height: 1.8;
}
.closing {
  margin-bottom: 4rem;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 1.5rem;
}
</style>
