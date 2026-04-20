import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

const llvmGrammar = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'llvm.tmLanguage.json'), 'utf-8')
)

export default defineConfig({
  title: 'ChadScript',
  description: 'Funny name. Serious performance. TypeScript compiled to native binaries that tie hand-written C — 250KB, 0.8ms cold start, no runtime.',

  base: '/ChadScript/',
  appearance: 'dark',

  head: [
    ['meta', { property: 'og:title', content: 'ChadScript — funny name, serious performance' }],
    ['meta', { property: 'og:description', content: 'TypeScript compiled to native code. Ties hand-written C. 250KB binaries, 0.8ms cold start, no runtime, no node_modules.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://cs01.github.io/ChadScript/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'ChadScript — funny name, serious performance' }],
    ['meta', { name: 'twitter:description', content: 'TypeScript compiled to native code. Ties hand-written C. 250KB binaries, 0.8ms cold start.' }],
  ],

  markdown: {
    languages: [llvmGrammar],
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Docs', link: '/getting-started/installation' },
      { text: 'Standard Library', link: '/stdlib/' },
      { text: 'Benchmarks', link: '/benchmarks' },
    ],

    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Quickstart', link: '/getting-started/quickstart' },
            { text: 'IDE Setup', link: '/getting-started/ide-setup' },
          ]
        },
        {
          text: 'Language',
          items: [
            { text: 'Features', link: '/language/features' },
            { text: 'Debugging', link: '/getting-started/debugging' },
          ]
        },
        {
          text: 'CLI',
          items: [
            { text: 'Commands', link: '/getting-started/cli' },
          ]
        },
        {
          text: 'Standard Library',
          link: '/stdlib/',
        },
        {
          text: 'Advanced',
          items: [
            { text: 'FFI', link: '/language/ffi' },
            { text: 'How It Works', link: '/language/architecture' },
            { text: 'Type Mappings', link: '/language/type-mappings' },
          ]
        },
      ],
      '/stdlib/': [
        {
          text: 'Standard Library',
          items: [
            { text: 'Overview', link: '/stdlib/' },
            { text: 'Array', link: '/stdlib/array' },
            { text: 'Async', link: '/stdlib/async' },
            { text: 'child_process', link: '/stdlib/child-process' },
            { text: 'console', link: '/stdlib/console' },
            { text: 'crypto', link: '/stdlib/crypto' },
            { text: 'Date', link: '/stdlib/date' },
            { text: 'embed', link: '/stdlib/embed' },
            { text: 'encoding', link: '/stdlib/encoding' },
            { text: 'fetch', link: '/stdlib/fetch' },
            { text: 'fs', link: '/stdlib/fs' },
            { text: 'HTTP Server', link: '/stdlib/http-server' },
            { text: 'JSON', link: '/stdlib/json' },
            { text: 'Map', link: '/stdlib/map' },
            { text: 'Math', link: '/stdlib/math' },
            { text: 'Number', link: '/stdlib/number' },
            { text: 'Object', link: '/stdlib/object' },
            { text: 'os', link: '/stdlib/os' },
            { text: 'path', link: '/stdlib/path' },
            { text: 'process', link: '/stdlib/process' },
            { text: 'RegExp', link: '/stdlib/regexp' },
            { text: 'Set', link: '/stdlib/set' },
            { text: 'sqlite', link: '/stdlib/sqlite' },
            { text: 'String', link: '/stdlib/string' },
            { text: 'Syscalls', link: '/stdlib/syscalls' },
            { text: 'Test Runner', link: '/stdlib/test-runner' },
            { text: 'tty', link: '/stdlib/tty' },
            { text: 'Uint8Array', link: '/stdlib/uint8array' },
            { text: 'URL', link: '/stdlib/url' },
          ]
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cs01/ChadScript' }
    ],

    footer: {
      message: '<a href="https://chadsmith.dev">chadsmith.dev</a> · <a href="https://github.com/cs01/ChadScript">GitHub</a> · <a href="https://x.com/cs01_software">X</a>'
    }
  }
})
