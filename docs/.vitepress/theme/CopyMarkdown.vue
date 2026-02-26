<!-- Copy-as-markdown button: lazily loads the raw .md source on click. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()
const copied = ref(false)

// Vite lazy-loads each .md as a raw string on demand (not bundled upfront)
const markdownModules = import.meta.glob('../../**/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

async function copyMarkdown() {
  // Map page's relativePath (e.g. "getting-started/cli.md") to glob key
  const key = `../../${page.value.relativePath}`
  const loader = markdownModules[key]
  if (!loader) return

  const raw = await loader()
  if (!raw) return

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(raw).then(() => flash(), () => fallbackCopy(raw))
  } else {
    fallbackCopy(raw)
  }
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '-9999px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  flash()
}

function flash() {
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <button
    v-if="page.relativePath !== 'index.md'"
    class="copy-markdown-btn"
    :class="{ copied }"
    @click="copyMarkdown"
  >
    {{ copied ? 'Copied!' : 'Copy as Markdown' }}
  </button>
</template>
