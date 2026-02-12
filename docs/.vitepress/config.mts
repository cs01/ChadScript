import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

export default defineConfig({
  title: 'ChadScript',
  description: 'Compile TypeScript to native binaries via LLVM',

  base: '/ChadScript/',
  appearance: 'dark',

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
      { text: 'Guide', link: '/getting-started/installation' },
      { text: 'API', link: '/stdlib/' },
      { text: 'Language', link: '/language/type-mappings' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Quick Start', link: '/getting-started/quickstart' },
          { text: 'CLI Reference', link: '/getting-started/cli' }
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
        text: 'Language',
        items: [
          { text: 'Type Mappings', link: '/language/type-mappings' },
          { text: 'Limitations', link: '/language/limitations' },
          { text: 'Architecture', link: '/language/architecture' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cs01/ChadScript' }
    ],

    footer: {
      message: 'Released under the MIT License.'
    }
  }
})
