<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const containerRef = ref<HTMLElement | null>(null)
const phase = ref<'idle' | 'typing' | 'compiling' | 'linked' | 'output' | 'done'>('idle')

const cmd = ref('')
const linkingState = ref<'idle' | 'linking' | 'done'>('idle')
const execOutput = ref('')
const execTime = ref('')

const fullCmd = 'chad run hello.ts'

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

async function run() {
  if (started) return
  started = true

  phase.value = 'typing'
  await delay(300)
  await typewriter(cmd, fullCmd, 45)
  await delay(500)

  phase.value = 'compiling'
  linkingState.value = 'linking'
  await delay(1400)

  phase.value = 'linked'
  linkingState.value = 'done'
  await delay(800)

  phase.value = 'output'
  execOutput.value = 'Hello from ChadScript!'
  await delay(200)
  execTime.value = '0.8ms'
  await delay(400)
  phase.value = 'done'
}

onMounted(() => {
  nextTick(() => {
    if (!containerRef.value) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started) {
          run()
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
    <h2 class="ir-heading">How it Works</h2>
    <p class="ir-subheading">Your TypeScript is parsed, type-checked, and lowered to LLVM IR — then compiled and linked into a standalone native binary.</p>

    <div class="pipeline-panel" :class="{ visible: phase !== 'idle' }">
      <div class="terminal-section" :class="{ visible: phase !== 'idle' }">
        <div class="terminal-chrome"><span class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></span><span class="terminal-label">Terminal</span></div>
        <div class="terminal-body">
          <div class="terminal-line">
            <span class="terminal-prompt">$</span>
            <span class="terminal-text">{{ cmd }}</span>
            <span v-if="phase === 'typing'" class="cursor">|</span>
          </div>
          <div v-if="execOutput" class="terminal-line terminal-output">
            {{ execOutput }}
          </div>
          <div v-if="execTime" class="timing-text">
            completed in {{ execTime }}
          </div>
        </div>
      </div>

      <div class="stage-link" :class="{ visible: linkingState !== 'idle' }">
        <div class="terminal-line">
          <span v-if="linkingState === 'linking'" class="link-row">
            <span class="spinner"></span>
            <span class="link-text">Compiling...</span>
          </span>
          <span v-else-if="linkingState === 'done'" class="link-row">
            <span class="checkmark">✓</span>
            <span class="link-text">hello: Mach-O 64-bit executable arm64, dynamically linked, stripped</span>
          </span>
        </div>
      </div>

      <div class="cta-section" :class="{ visible: phase === 'done' }">
        <p class="cta-tagline">No build step. No install. Just <code>chad run yourfile.ts</code> and it compiles + runs instantly.</p>
        <div class="cta-buttons">
          <a href="/ChadScript/getting-started/installation" class="cta-link">Get Started</a>
          <a href="/ChadScript/why-chadscript" class="cta-link secondary">What is ChadScript?</a>
        </div>
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
  margin-bottom: 1.2rem;
  max-width: 640px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.5;
}

.pipeline-panel {
  display: flex;
  flex-direction: column;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.pipeline-panel.visible {
  opacity: 1;
  transform: translateY(0);
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

.cursor {
  color: var(--vp-c-brand-1);
  animation: blink 0.6s step-end infinite;
  font-weight: 300;
}

@keyframes blink {
  50% { opacity: 0; }
}

.terminal-section {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 0;
  overflow: hidden;
  transition: opacity 0.3s ease;
}

.terminal-section.visible {
  opacity: 1;
}

.terminal-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.terminal-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.terminal-body {
  padding: 8px 16px;
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

.stage-link {
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 8px;
  height: 38px;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.stage-link.visible {
  opacity: 1;
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
  margin-top: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  animation: fade-in 0.4s ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.cta-section {
  text-align: center;
  margin-top: 8px;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.cta-section.visible {
  opacity: 1;
}

.cta-tagline {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  margin: 0 0 8px;
}

.cta-buttons {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.cta-link {
  display: inline-block;
  padding: 8px 20px;
  font-size: 0.85rem;
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

.cta-link.secondary {
  background: none;
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--vp-c-text-2);
}

.cta-link.secondary:hover {
  border-color: rgba(255, 255, 255, 0.15);
  color: var(--vp-c-text-1);
}

@media (max-width: 768px) {
  .ir-showcase {
    padding: 0 16px;
  }

  .terminal-line {
    font-size: 0.72rem;
  }
}
</style>
