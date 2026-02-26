<script setup lang="ts">
import { ref } from 'vue'
import { useData } from 'vitepress'

const { page, frontmatter } = useData()
const copied = ref(false)

async function copyMarkdown() {
  const raw = (frontmatter.value as any).rawMarkdown
  if (!raw) return

  try {
    await navigator.clipboard.writeText(raw)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = raw
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
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
