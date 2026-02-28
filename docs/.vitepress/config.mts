import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

const llvmGrammar = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'llvm.tmLanguage.json'), 'utf-8')
)

export default defineConfig({
  title: 'ChadScript',
  description: 'Compile TypeScript to native binaries via LLVM',

  base: '/ChadScript/',
  appearance: 'dark',

  markdown: {
    languages: [llvmGrammar],
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Why ChadScript?', link: '/why-chadscript' },
      { text: 'Get Started', link: '/getting-started/installation' },
      { text: 'API Reference', link: '/stdlib/' },
      { text: 'Benchmarks', link: '/benchmarks' },
      { text: 'GitHub', link: 'https://github.com/cs01/ChadScript' }
    ],

    sidebar: [
      {
        text: 'Why ChadScript?',
        items: [
          { text: 'Why ChadScript?', link: '/why-chadscript' },
          { text: 'Benchmarks', link: '/benchmarks' },
          { text: 'FAQ', link: '/faq' },
        ]
      },
      {
        text: 'Get Started',
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Quickstart', link: '/getting-started/quickstart' },
          { text: 'CLI Reference', link: '/getting-started/cli' },
          { text: 'Debugging', link: '/getting-started/debugging' },
        ]
      },
      {
        text: 'Language',
        items: [
          { text: 'Supported Features', link: '/language/features' },
          { text: 'Classes & Interfaces', link: '/language/classes' },
          { text: 'Type Mappings', link: '/language/type-mappings' },
          { text: 'How It Works', link: '/language/architecture' },
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/stdlib/' },
          { text: 'Array Methods', link: '/stdlib/array' },
          { text: 'Async', link: '/stdlib/async' },
          { text: 'ChadScript.embed', link: '/stdlib/embed' },
          { text: 'child_process', link: '/stdlib/child-process' },
          { text: 'console', link: '/stdlib/console' },
          { text: 'crypto', link: '/stdlib/crypto' },
          { text: 'Date', link: '/stdlib/date' },
          { text: 'fetch', link: '/stdlib/fetch' },
          { text: 'fs', link: '/stdlib/fs' },
          { text: 'httpServe', link: '/stdlib/http-server' },
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
          { text: 'String Methods', link: '/stdlib/string' },
          { text: 'Syscalls', link: '/stdlib/syscalls' },
          { text: 'tty', link: '/stdlib/tty' }
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cs01/ChadScript' }
    ],

    footer: {
      message: '<a href="https://chadsmith.dev">chadsmith.dev</a> · <a href="https://github.com/cs01/ChadScript">GitHub</a> · <a href="https://x.com/cs01_software">X</a>'
    }
  }
})
