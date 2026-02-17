<script setup lang="ts">
import { ref, computed } from 'vue'

const activeTab = ref(0)
const copied = ref(false)

const examples = [
  {
    label: 'Hello World',
    file: 'hello.ts',
    code: `console.log("Hello from ChadScript!");`,
    run: '$ chad run hello.ts',
    output: `Hello from ChadScript!`,
  },
  {
    label: 'HTTP Server',
    file: 'server.ts',
    code: `function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/") {
    return { status: 200, body: "Hello, world!" };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);`,
    run: '$ chad run server.ts',
    output: `listening on port 3000`,
  },
  {
    label: 'File I/O',
    file: 'word-count.ts',
    code: `const content = fs.readFileSync("README.md");
const lines = content.split("\\n");
console.log(lines.length + " lines");`,
    run: '$ chad run word-count.ts',
    output: `61 lines`,
  },
  {
    label: 'SQLite',
    file: 'query.ts',
    code: `const db = sqlite.open("app.db");
sqlite.exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
sqlite.exec(db, "INSERT INTO users (name) VALUES ('Alice')");
const rows = sqlite.all(db, "SELECT * FROM users");
console.log(rows);
sqlite.close(db);`,
    run: '$ chad run query.ts',
    output: `[{"id":1,"name":"Alice"}]`,
  },
  {
    label: 'Async',
    file: 'parallel.ts',
    code: `async function main() {
  const a = fetch("https://api.example.com/users");
  const b = fetch("https://api.example.com/posts");
  const [users, posts] = await Promise.all([a, b]);
  console.log("users: " + users.status);
  console.log("posts: " + posts.status);
}

main();`,
    run: '$ chad run parallel.ts',
    output: `users: 200\nposts: 200`,
  },
]

const keywords = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'new', 'async', 'await', 'class', 'import', 'export', 'from', 'of', 'in',
])

const types = new Set([
  'Request', 'Response', 'HttpRequest', 'HttpResponse', 'string', 'number', 'boolean', 'void',
])

const builtins = new Set([
  'console', 'process', 'fs', 'JSON', 'sqlite', 'httpServe', 'fetch',
])

function highlight(code: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return code.replace(
    /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(\d+)\b|(\b[a-zA-Z_]\w*\b)/g,
    (match, comment, str, num, word) => {
      if (comment) return `<span class="hl-comment">${esc(comment)}</span>`
      if (str) return `<span class="hl-string">${esc(str)}</span>`
      if (num) return `<span class="hl-number">${esc(num)}</span>`
      if (word) {
        if (keywords.has(word)) return `<span class="hl-keyword">${esc(word)}</span>`
        if (types.has(word)) return `<span class="hl-type">${esc(word)}</span>`
        if (builtins.has(word)) return `<span class="hl-builtin">${esc(word)}</span>`
      }
      return esc(match)
    }
  )
}

const highlightedCode = computed(() => highlight(examples[activeTab.value].code))

let copyTimeout: ReturnType<typeof setTimeout> | null = null

function copyCode() {
  const code = examples[activeTab.value].code
  navigator.clipboard.writeText(code)
  copied.value = true
  if (copyTimeout) clearTimeout(copyTimeout)
  copyTimeout = setTimeout(() => { copied.value = false }, 1500)
}
</script>

<template>
  <div class="example-tabs">
    <h2 class="example-heading">Examples</h2>
    <div class="tab-bar">
      <button
        v-for="(ex, i) in examples"
        :key="i"
        :class="{ active: activeTab === i }"
        @click="activeTab = i"
      >{{ ex.label }}</button>
    </div>
    <div class="tab-panel">
      <div class="panel-header">
        <span class="panel-filename">{{ examples[activeTab].file }}</span>
        <button class="copy-btn" :class="{ copied }" @click="copyCode">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <pre class="panel-code"><code v-html="highlightedCode"></code></pre>
      <div class="panel-terminal">
        <div class="terminal-line terminal-cmd">{{ examples[activeTab].run }}</div>
        <div class="terminal-line terminal-out">{{ examples[activeTab].output }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.example-tabs {
  max-width: 960px;
  margin: 2.5rem auto 0;
  padding: 0 24px;
}

.example-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 1.2rem;
  border: none;
  color: var(--vp-c-text-1);
}

.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tab-bar button {
  background: none;
  border: none;
  padding: 0.55rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
  font-family: inherit;
}

.tab-bar button:hover {
  color: var(--vp-c-text-2);
}

.tab-bar button.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.tab-panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: none;
  border-radius: 0 0 10px 10px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-filename {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.copy-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.copy-btn:hover {
  color: var(--vp-c-text-1);
  border-color: rgba(255, 255, 255, 0.2);
}

.copy-btn.copied {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
}

.panel-code {
  margin: 0;
  padding: 14px 16px;
  font-size: 0.82rem;
  line-height: 1.65;
  overflow-x: auto;
  background: transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-code code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  background: none;
}

.panel-code :deep(.hl-keyword) { color: #c678dd; }
.panel-code :deep(.hl-string) { color: #98c379; }
.panel-code :deep(.hl-number) { color: #d19a66; }
.panel-code :deep(.hl-builtin) { color: #e5c07b; }
.panel-code :deep(.hl-type) { color: #61afef; }
.panel-code :deep(.hl-comment) { color: #5c6370; font-style: italic; }

.panel-terminal {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.15);
}

.terminal-line {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  line-height: 1.6;
}

.terminal-cmd {
  color: var(--vp-c-text-2);
}

.terminal-out {
  color: var(--vp-c-text-3);
}

@media (max-width: 768px) {
  .tab-bar {
    overflow-x: auto;
  }

  .tab-bar button {
    white-space: nowrap;
    padding: 0.5rem 0.8rem;
    font-size: 0.8rem;
  }
}
</style>
