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
      const rawMarkdown = fs.readFileSync(mdPath, 'utf-8')
      return { frontmatter: { ...pageData.frontmatter, rawMarkdown } }
    } catch {
      return {}
    }
  },

  themeConfig: {
    search: {
      provider: 'local'
    },

    nav: [
      { text: 'Get Started', link: '/getting-started/installation' },
      { text: 'API', link: '/stdlib/' },
      { text: 'Benchmarks', link: '/benchmarks' },
      { text: 'GitHub', link: 'https://github.com/cs01/ChadScript' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'About ChadScript', link: '/language/architecture' },
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Examples', link: '/getting-started/quickstart' },
          { text: 'CLI Reference', link: '/getting-started/cli' },
          { text: 'Supported Features', link: '/language/limitations' },
          { text: 'Debugging', link: '/getting-started/debugging' }
        ]
      },
      {
        text: 'Standard Library',
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
      {
        text: 'Performance',
        items: [
          { text: 'Benchmarks', link: '/benchmarks' }
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
