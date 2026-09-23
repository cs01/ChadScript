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

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/subset" },
      { text: "How it works", link: "/internals/how-it-works" },
      { text: "Benchmarks", link: "/benchmarks" },
      { text: "Roadmap", link: "/roadmap" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Language overview", link: "/guide/language" },
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
        text: "Reference",
        items: [
          { text: "Accepted subset", link: "/reference/subset" },
          { text: "Error codes", link: "/reference/errors" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "How it works", link: "/internals/how-it-works" },
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
        'Pre-alpha. MIT licensed. <a href="https://github.com/cs01/ChadScript/tree/main">Source on GitHub</a>',
    },
  },
});
