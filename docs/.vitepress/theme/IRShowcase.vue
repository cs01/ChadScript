<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const containerRef = ref<HTMLElement | null>(null)
const phase = ref<'idle' | 'typing-source' | 'typing-build' | 'ready-compile' | 'compiling' | 'typing-run' | 'ready-run' | 'running' | 'done'>('idle')

const sourceText = ref('')
const buildCmd = ref('')
const runCmd = ref('')
const irVisibleCount = ref(0)
const linkingState = ref<'idle' | 'linking' | 'done'>('idle')
const execOutput = ref('')
const execTime = ref('')

const fullSource = 'console.log("Hello from ChadScript!");'
const fullBuildCmd = 'chad build hello.ts'
const fullRunCmd = './hello'

const irLines = [
  '@.str.0 = private constant [24 x i8] c"Hello from ChadScript!\\0A\\00"',
  '',
  'declare i32 @printf(i8*, ...)',
  '',
  'define i32 @main(i32 %argc, i8** %argv) {',
  'entry:',
  '  %0 = getelementptr [24 x i8], [24 x i8]* @.str.0, i64 0, i64 0',
  '  call i32 @printf(i8* %0)',
  '  ret i32 0',
  '}',
]

const irKeywords = new Set([
  'define', 'declare', 'global', 'constant', 'private', 'internal',
  'external', 'unnamed_addr', 'align', 'to', 'nuw', 'nsw',
])

const irInstructions = new Set([
  'ret', 'br', 'call', 'alloca', 'load', 'store', 'getelementptr',
  'add', 'sub', 'mul', 'icmp', 'fcmp', 'phi', 'select',
  'trunc', 'zext', 'sext', 'bitcast', 'ptrtoint', 'inttoptr',
])

const irTypes = new Set([
  'i1', 'i8', 'i16', 'i32', 'i64', 'i128', 'float', 'double', 'void', 'ptr',
])

function highlightIR(line: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (line === '') return ''

  if (/^[a-zA-Z_]\w*:$/.test(line.trim())) {
    return `<span class="ir-label">${esc(line)}</span>`
  }

  return line.replace(
    /(;[^\n]*)|(c"[^"]*"|"[^"]*")|(@[a-zA-Z$._][\w$.]*)|(%[a-zA-Z$._][\w$.]*|%\d+)|(\b-?\d+\b)|(\b[a-zA-Z_]\w*\b)/g,
    (match, comment, str, global, local, num, word) => {
      if (comment) return `<span class="ir-comment">${esc(comment)}</span>`
      if (str) return `<span class="ir-string">${esc(str)}</span>`
      if (global) return `<span class="ir-global">${esc(global)}</span>`
      if (local) return `<span class="ir-local">${esc(local)}</span>`
      if (num !== undefined && num !== '') return `<span class="ir-number">${esc(num)}</span>`
      if (word) {
        if (irKeywords.has(word)) return `<span class="ir-keyword">${esc(word)}</span>`
        if (irInstructions.has(word)) return `<span class="ir-instr">${esc(word)}</span>`
        if (irTypes.has(word)) return `<span class="ir-type">${esc(word)}</span>`
      }
      return esc(match)
    }
  )
}

const highlightedIR = computed(() => irLines.map(highlightIR))

const hexVisible = computed(() =>
  phase.value === 'ready-compile' || phase.value === 'compiling' ||
  phase.value === 'ready-run' || phase.value === 'running' ||
  (phase.value === 'typing-run')
)

const ctaVisible = computed(() => phase.value === 'done')

const hexActive = computed(() =>
  phase.value === 'ready-compile' || phase.value === 'ready-run'
)

const hexLabel = computed(() => {
  switch (phase.value) {
    case 'ready-compile': return 'Build'
    case 'compiling': return '...'
    case 'typing-run': return '✓'
    case 'ready-run': return 'Run'
    case 'running': return '...'
    case 'done': return '✓'
    default: return ''
  }
})

const hexHint = computed(() => {
  switch (phase.value) {
    case 'ready-compile': return 'click to compile'
    case 'compiling': return 'compiling'
    case 'typing-run': return 'compiled'
    case 'ready-run': return 'click to run'
    case 'running': return 'running'
    case 'done': return 'done'
    default: return ''
  }
})

let observer: IntersectionObserver | null = null
let timeouts: ReturnType<typeof setTimeout>[] = []
let started = false

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    timeouts.push(t)
  })
}

function typewriter(target: { value: string }, text: string, speed: number): Promise<void> {
  return new Promise(resolve => {
    let i = 0
    function tick() {
      if (i < text.length) {
        target.value = text.slice(0, i + 1)
        i++
        const t = setTimeout(tick, speed)
        timeouts.push(t)
      } else {
        resolve()
      }
    }
    tick()
  })
}

async function startTyping() {
  if (started) return
  started = true
  phase.value = 'typing-source'
  await delay(300)
  await typewriter(sourceText, fullSource, 35)
  await delay(400)

  phase.value = 'typing-build'
  await delay(200)
  await typewriter(buildCmd, fullBuildCmd, 40)
  await delay(200)
  phase.value = 'ready-compile'
}

function hexClick() {
  if (phase.value === 'ready-compile') compile()
  else if (phase.value === 'ready-run') run()
}

async function compile() {
  phase.value = 'compiling'

  await delay(400)
  for (let i = 0; i < irLines.length; i++) {
    irVisibleCount.value = i + 1
    await delay(irLines[i] === '' ? 20 : 80)
  }
  await delay(300)

  linkingState.value = 'linking'
  await delay(1200)
  linkingState.value = 'done'
  await delay(500)

  phase.value = 'typing-run'
  await delay(300)
  await typewriter(runCmd, fullRunCmd, 50)
  await delay(200)
  phase.value = 'ready-run'
}

async function run() {
  phase.value = 'running'

  await delay(150)
  execOutput.value = 'Hello from ChadScript!'
  execTime.value = '1.9ms'
  await delay(300)
  phase.value = 'done'
}

onMounted(() => {
  nextTick(() => {
    if (!containerRef.value) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started) {
          startTyping()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(containerRef.value)
  })
})

onUnmounted(() => {
  if (observer) observer.disconnect()
  timeouts.forEach(t => clearTimeout(t))
})
</script>

<template>
  <div class="ir-showcase" ref="containerRef">
    <h2 class="ir-heading">What's Under the Hood</h2>
    <p class="ir-subheading">Your TypeScript is parsed, type-checked, and lowered to LLVM IR — then compiled and linked into a standalone native binary. No interpreter. No JIT. Just native machine code.</p>

    <div class="pipeline-panel" :class="{ visible: phase !== 'idle' }">

      <div class="stage-source" v-if="phase !== 'idle'">
        <div class="panel-header">
          <span class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></span>
          <span class="panel-label">hello.ts</span>
        </div>
        <pre class="panel-code"><code>console.log(<span class="hl-string">"Hello from ChadScript!"</span>)<span v-if="sourceText.length < fullSource.length && phase === 'typing-source'" class="cursor">|</span></code></pre>
        <div
          class="code-mask"
          :style="{ width: (100 - (sourceText.length / fullSource.length) * 100) + '%' }"
        ></div>
      </div>

      <div
        class="terminal-section"
        :class="{ visible: phase !== 'idle' && phase !== 'typing-source' }"
      >
        <div class="terminal-line">
          <span class="terminal-prompt">$</span>
          <span class="terminal-text">{{ buildCmd }}</span>
          <span v-if="(phase === 'typing-build' || phase === 'ready-compile') && buildCmd.length <= fullBuildCmd.length" class="cursor">|</span>
        </div>
      </div>

      <div class="stage-ir" :class="{ visible: irVisibleCount > 0 }">
        <div class="panel-header">
          <span class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></span>
          <span class="panel-label">LLVM IR</span>
          <span v-if="irVisibleCount >= irLines.length" class="ir-badge">generated</span>
        </div>
        <pre class="panel-code ir-code"><code><template v-for="(line, i) in irLines" :key="i"><span
          v-if="i < irVisibleCount"
          class="ir-line"
          :class="{ 'ir-entering': i === irVisibleCount - 1 }"
        ><template v-if="line === ''">
</template><span v-else v-html="highlightedIR[i] + '\n'"></span></span></template></code></pre>
      </div>

      <div class="stage-link" :class="{ visible: linkingState !== 'idle' }">
        <div class="terminal-line">
          <span v-if="linkingState === 'linking'" class="link-row">
            <span class="spinner"></span>
            <span class="link-text">Linking...</span>
          </span>
          <span v-else-if="linkingState === 'done'" class="link-row">
            <span class="checkmark">✓</span>
            <span class="link-text">hello: ELF 64-bit LSB executable, x86-64 (42 KB)</span>
          </span>
        </div>
      </div>

      <div
        class="terminal-section"
        :class="{ visible: phase === 'typing-run' || phase === 'ready-run' || phase === 'running' || phase === 'done' }"
      >
        <div class="terminal-line">
          <span class="terminal-prompt">$</span>
          <span class="terminal-text">{{ runCmd }}</span>
          <span v-if="(phase === 'typing-run' || phase === 'ready-run') && runCmd.length <= fullRunCmd.length" class="cursor">|</span>
        </div>
        <div v-if="execOutput" class="terminal-line terminal-output">
          {{ execOutput }}
        </div>
        <div v-if="execTime" class="timing-text">
          completed in {{ execTime }}
        </div>
      </div>

      <div class="hex-section" :class="{ visible: hexVisible }">
        <div class="hex-prompt" :class="{ active: hexActive, spinning: phase === 'compiling' || phase === 'running' }" @click="hexClick">
          <div class="hex-container">
            <svg class="hex-ring" viewBox="0 0 100 100">
              <polygon points="50,3 93,25 93,75 50,97 7,75 7,25" fill="none" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <svg class="hex-icon" viewBox="0 0 100 100">
              <polygon points="50,3 93,25 93,75 50,97 7,75 7,25" fill="rgba(245, 158, 11, 0.06)" stroke="currentColor" stroke-width="2"/>
            </svg>
            <span class="hex-label">{{ hexLabel }}</span>
          </div>
          <span class="hex-hint">{{ hexHint }}</span>
        </div>
      </div>

      <div class="cta-section" :class="{ visible: ctaVisible }">
        <a href="/ChadScript/getting-started/installation" class="cta-link">Get Started with ChadScript</a>
      </div>

    </div>
  </div>
</template>

<style scoped>
.ir-showcase {
  max-width: 720px;
  margin: 2rem auto 0;
  padding: 0 24px;
}

.ir-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  border: none;
  color: var(--vp-c-text-1);
}

.ir-subheading {
  text-align: center;
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1.8rem;
  max-width: 640px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.5;
}

.pipeline-panel {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--vp-c-bg-soft);
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.pipeline-panel.visible {
  opacity: 1;
  transform: translateY(0);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.window-dots {
  display: flex;
  gap: 6px;
  margin-right: 4px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.dot.red { background: #c44; }
.dot.yellow { background: #b89530; }
.dot.green { background: #2a9a38; }

.panel-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}

.panel-code {
  margin: 0;
  padding: 14px 16px;
  font-size: 0.82rem;
  line-height: 1.7;
  overflow-x: auto;
  background: transparent;
}

.panel-code code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  background: none;
}

.stage-source {
  position: relative;
}

.code-mask {
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 0;
  background: var(--vp-c-bg-soft);
  pointer-events: none;
  transition: width 0.02s linear;
}

.hl-string { color: #a5d6a7; }

.cursor {
  color: var(--vp-c-brand-1);
  animation: blink 0.6s step-end infinite;
  font-weight: 300;
}

@keyframes blink {
  50% { opacity: 0; }
}

.terminal-section {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.15);
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.3s ease;
}

.terminal-section.visible {
  opacity: 1;
  max-height: 200px;
}

.terminal-line {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.terminal-prompt {
  color: var(--vp-c-brand-1);
  margin-right: 8px;
}

.terminal-text {
  color: var(--vp-c-text-1);
}

.terminal-output {
  color: var(--vp-c-text-3);
}

.hex-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.3s ease;
}

.hex-section.visible {
  opacity: 1;
  max-height: 140px;
}

.hex-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  transition: opacity 0.3s ease;
}

.hex-prompt.active {
  cursor: pointer;
}

.hex-prompt.active:hover .hex-container {
  transform: scale(1.12);
}

.hex-prompt.active:hover .hex-icon {
  filter: drop-shadow(0 0 12px rgba(245, 158, 11, 0.6));
}

.hex-prompt.active:hover .hex-ring {
  opacity: 0;
}

.hex-container {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s ease;
}

.hex-icon {
  position: absolute;
  inset: 0;
  color: var(--vp-c-text-3);
  transition: color 0.3s ease, filter 0.3s ease;
}

.hex-prompt.active .hex-icon {
  color: var(--vp-c-brand-1);
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.3));
  animation: hex-rotate 8s linear infinite;
}

.hex-prompt.spinning .hex-icon {
  animation: hex-rotate 2s linear infinite;
}

.hex-ring {
  position: absolute;
  inset: -8px;
  color: var(--vp-c-text-3);
  opacity: 0;
  transition: opacity 0.3s ease, color 0.3s ease;
}

.hex-prompt.active .hex-ring {
  color: var(--vp-c-brand-1);
  opacity: 0.3;
  animation: hex-pulse 2s ease-in-out infinite;
}

@keyframes hex-rotate {
  to { transform: rotate(360deg); }
}

@keyframes hex-pulse {
  0%, 100% {
    opacity: 0.15;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(1.12);
  }
}

.hex-label {
  position: relative;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--vp-c-text-3);
  transition: color 0.3s ease;
}

.hex-prompt.active .hex-label {
  color: var(--vp-c-text-1);
}

.hex-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
  transition: color 0.3s ease;
}

.hex-prompt.active .hex-hint {
  color: var(--vp-c-brand-1);
}

.cta-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.4s ease, max-height 0.3s ease;
}

.cta-section.visible {
  opacity: 1;
  max-height: 80px;
}

.cta-link {
  display: inline-block;
  margin: 14px auto;
  padding: 10px 24px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.cta-link:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
}

.cta-section.visible {
  opacity: 1;
  max-height: 80px;
  text-align: center;
}

.stage-ir {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.5s ease;
}

.stage-ir.visible {
  opacity: 1;
  max-height: 500px;
}

.ir-code {
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.ir-code :deep(.ir-keyword) { color: #c678dd; }
.ir-code :deep(.ir-instr) { color: #61afef; }
.ir-code :deep(.ir-type) { color: #e5c07b; }
.ir-code :deep(.ir-global) { color: #98c379; }
.ir-code :deep(.ir-local) { color: #d19a66; }
.ir-code :deep(.ir-string) { color: #98c379; }
.ir-code :deep(.ir-number) { color: #d19a66; }
.ir-code :deep(.ir-comment) { color: #5c6370; font-style: italic; }
.ir-code :deep(.ir-label) { color: #e5c07b; }

.ir-line {
  display: block;
  opacity: 1;
}

.ir-line.ir-entering {
  animation: ir-slide-in 0.15s ease-out;
}

@keyframes ir-slide-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ir-badge {
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  animation: fade-in 0.3s ease;
}

.stage-link {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.15);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.3s ease;
}

.stage-link.visible {
  opacity: 1;
  max-height: 200px;
}

.link-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.link-text {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.checkmark {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  font-weight: 700;
}

.timing-text {
  margin-top: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  animation: fade-in 0.4s ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 768px) {
  .ir-showcase {
    padding: 0 16px;
  }

  .panel-code {
    font-size: 0.75rem;
  }

  .ir-code {
    font-size: 0.68rem;
  }
}
</style>
