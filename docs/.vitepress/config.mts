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

  transformPageData(pageData) {
    const mdPath = path.resolve(__dirname, '..', pageData.relativePath)
    try {
      pageData.frontmatter.__rawMarkdown = fs.readFileSync(mdPath, 'utf-8')
    } catch {}
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Get Started', link: '/getting-started/installation' },
      { text: 'API', link: '/stdlib/' },
      { text: 'Benchmarks', link: '/benchmarks' },
      { text: 'Language', link: '/language/limitations' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Get Started', link: '/getting-started/installation' },
          { text: 'Examples', link: '/getting-started/quickstart' },
          { text: 'CLI Reference', link: '/getting-started/cli' },
          { text: 'Debugging', link: '/getting-started/debugging' }
        ]
      },
      {
        text: 'Standard Library',
        items: [
          { text: 'Overview', link: '/stdlib/' },
          { text: 'console', link: '/stdlib/console' },
          { text: 'process', link: '/stdlib/process' },
          { text: 'fs', link: '/stdlib/fs' },
          { text: 'path', link: '/stdlib/path' },
          { text: 'child_process', link: '/stdlib/child-process' },
          { text: 'tty', link: '/stdlib/tty' },
          { text: 'Math', link: '/stdlib/math' },
          { text: 'JSON', link: '/stdlib/json' },
          { text: 'Date', link: '/stdlib/date' },
          { text: 'crypto', link: '/stdlib/crypto' },
          { text: 'sqlite', link: '/stdlib/sqlite' },
          { text: 'fetch', link: '/stdlib/fetch' },
          { text: 'httpServe', link: '/stdlib/http-server' },
          { text: 'ChadScript.embed', link: '/stdlib/embed' },
          { text: 'String Methods', link: '/stdlib/string' },
          { text: 'Number', link: '/stdlib/number' },
          { text: 'Array Methods', link: '/stdlib/array' },
          { text: 'Map', link: '/stdlib/map' },
          { text: 'Set', link: '/stdlib/set' },
          { text: 'RegExp', link: '/stdlib/regexp' },
          { text: 'Object', link: '/stdlib/object' },
          { text: 'Async', link: '/stdlib/async' },
          { text: 'Low-Level / Syscalls', link: '/stdlib/syscalls' }
        ]
      },
      {
        text: 'Performance',
        items: [
          { text: 'Benchmarks', link: '/benchmarks' }
        ]
      },
      {
        text: 'Language',
        items: [
          { text: 'How it Works', link: '/language/architecture' },
          { text: 'Language Support', link: '/language/limitations' },
          { text: 'Classes & Interfaces', link: '/language/classes' }
        ]
      },
      {
        text: 'Resources',
        items: [
          { text: 'FAQ', link: '/faq' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cs01/ChadScript' }
    ],

    footer: {
      message: '<a href="https://chadsmith.dev">chadsmith.dev</a> · <a href="https://github.com/cs01/ChadScript">GitHub</a> · <a href="https://x.com/cs01_software">X</a>'
    }
  }
})
