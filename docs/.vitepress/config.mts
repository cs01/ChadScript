import { defineConfig } from "vitepress";

// Site for the current compiler (v2 of the design; v1 lives on branch `v1`). Code samples are embedded from docs/examples/ with `<<< @/examples/...`
// so each one is a program the test suite compiles and diffs against Node
// (tests/slow/docs-examples.test.ts). Dead internal links fail the build (VitePress default).
export default defineConfig({
  title: "ChadScript",
  description:
    "An ahead-of-time compiler for a statically analyzable subset of TypeScript: small native binaries that behave exactly like Node.",
  base: "/ChadScript/",
  appearance: "dark",
  cleanUrls: true,
  lastUpdated: true,

  // Inputs to generated pages and planning notes, not pages of their own.
  srcExclude: ["SUBSET.md", "async-design.md", "generated/**", "examples/**", "scripts/**"],

  head: [["meta", { name: "theme-color", content: "#f59e0b" }]],

  themeConfig: {
    search: { provider: "local" },

    // Organized by what the reader is doing (tutorial, task, lookup, understanding).
    nav: [
      { text: "Quickstart", link: "/guide/getting-started" },
      { text: "How-to", link: "/howto/multi-file" },
      { text: "Reference", link: "/guide/language" },
      { text: "How it works", link: "/internals/how-it-works" },
      { text: "Benchmarks", link: "/benchmarks" },
      { text: "Roadmap", link: "/roadmap" },
      { text: "Releases", link: "https://github.com/cs01/ChadScript/releases" },
    ],

    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Quickstart", link: "/guide/getting-started" },
          { text: "Is ChadScript for you?", link: "/reference/limitations" },
        ],
      },
      {
        text: "How-to guides",
        items: [
          { text: "Build a multi-file project", link: "/howto/multi-file" },
          { text: "Parse a JSON config file", link: "/howto/json-config" },
          { text: "Build a CLI tool", link: "/howto/cli-tool" },
        ],
      },
      {
        text: "Language reference",
        items: [
          { text: "Overview", link: "/guide/language" },
          { text: "Modules and imports", link: "/guide/modules" },
          { text: "Classes and interfaces", link: "/guide/classes" },
          { text: "Unions and narrowing", link: "/guide/unions" },
          { text: "Generics", link: "/guide/generics" },
          { text: "Closures", link: "/guide/closures" },
          { text: "Map and Set", link: "/guide/collections" },
          { text: "async / await", link: "/guide/async" },
          { text: "Errors", link: "/guide/errors" },
          { text: "JSON", link: "/guide/json" },
          { text: "node:fs and node:path", link: "/guide/node-modules" },
          { text: "console.log", link: "/guide/console" },
        ],
      },
      {
        text: "Lookup",
        items: [
          { text: "Accepted subset", link: "/reference/subset" },
          { text: "Error codes", link: "/reference/errors" },
          { text: "CLI", link: "/reference/cli" },
        ],
      },
      {
        text: "How it works",
        items: [
          { text: "Pipeline", link: "/internals/how-it-works" },
          { text: "Value model", link: "/internals/value-model" },
          { text: "Memory", link: "/internals/memory" },
          { text: "Testing philosophy", link: "/internals/testing" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
    ],

    editLink: {
      pattern: "https://github.com/cs01/ChadScript/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    socialLinks: [{ icon: "github", link: "https://github.com/cs01/ChadScript/tree/main" }],

    footer: {
      message:
        'Alpha. MIT licensed. <a href="https://github.com/cs01/ChadScript">Source on GitHub</a> · <a href="https://github.com/cs01/ChadScript/releases">Releases</a> · <a href="https://github.com/cs01/ChadScript/issues/new?title=divergence%3A+">Report a program that behaves differently from Node</a>',
    },
  },
});
