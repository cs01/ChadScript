<!-- Single-terminal animation showing the full ChadScript build-and-run flow.
     One terminal accumulates: echo > file, chad build, ./hello.
     Linking indicator appears between build and run steps.
     Hex button drives the two user interactions (Build, Run). -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const containerRef = ref<HTMLElement | null>(null)
const phase = ref<'idle' | 'typing-echo' | 'typing-build' | 'ready-compile' | 'compiling' | 'typing-run' | 'ready-run' | 'running' | 'done'>('idle')

const echoCmd = ref('')
const buildCmd = ref('')
const runCmd = ref('')
const linkingState = ref<'idle' | 'linking' | 'done'>('idle')
const execOutput = ref('')
const execTime = ref('')

const fullEchoCmd = "echo 'console.log(\"Hello from ChadScript!\")' > hello.ts"
const fullBuildCmd = 'chad build hello.ts'
const fullRunCmd = './hello'


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

// Which command lines are visible (accumulated in one terminal)
const showEcho = computed(() => phase.value !== 'idle')
const showBuild = computed(() =>
  phase.value !== 'idle' && phase.value !== 'typing-echo'
)
const showRun = computed(() =>
  phase.value === 'typing-run' || phase.value === 'ready-run' ||
  phase.value === 'running' || phase.value === 'done'
)

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

  // Type the echo command first
  phase.value = 'typing-echo'
  await delay(300)
  await typewriter(echoCmd, fullEchoCmd, 25)
  await delay(400)

  // Then the build command
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
  linkingState.value = 'linking'
  await delay(1200)
  linkingState.value = 'done'
  await delay(500)

  // Type run command in the same terminal
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
    <h2 class="ir-heading">How it Works</h2>
    <p class="ir-subheading">Your TypeScript is parsed, type-checked, and lowered to LLVM IR — then compiled and linked into a standalone native binary.</p>

    <div class="pipeline-panel" :class="{ visible: phase !== 'idle' }">

      <!-- Single terminal for all commands -->
      <div
        class="terminal-section"
        :class="{ visible: phase !== 'idle' }"
      >
        <div class="terminal-chrome"><span class="window-dots"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span></span><span class="terminal-label">Terminal</span></div>
        <div class="terminal-body">
          <!-- echo command -->
          <div v-if="showEcho" class="terminal-line">
            <span class="terminal-prompt">$</span>
            <span class="terminal-text">{{ echoCmd }}</span>
            <span v-if="phase === 'typing-echo'" class="cursor">|</span>
          </div>
          <!-- build command -->
          <div v-if="showBuild" class="terminal-line">
            <span class="terminal-prompt">$</span>
            <span class="terminal-text">{{ buildCmd }}</span>
            <span v-if="(phase === 'typing-build' || phase === 'ready-compile') && buildCmd.length <= fullBuildCmd.length" class="cursor">|</span>
          </div>
          <!-- run command -->
          <div v-if="showRun" class="terminal-line">
            <span class="terminal-prompt">$</span>
            <span class="terminal-text">{{ runCmd }}</span>
            <span v-if="(phase === 'typing-run' || phase === 'ready-run') && runCmd.length <= fullRunCmd.length" class="cursor">|</span>
          </div>
          <!-- execution output -->
          <div v-if="execOutput" class="terminal-line terminal-output">
            {{ execOutput }}
          </div>
          <div v-if="execTime" class="timing-text">
            completed in {{ execTime }}
          </div>
        </div>
      </div>

      <!-- Linking indicator -->
      <div class="stage-link" :class="{ visible: linkingState !== 'idle' }">
        <div class="terminal-line">
          <span v-if="linkingState === 'linking'" class="link-row">
            <span class="spinner"></span>
            <span class="link-text">Linking...</span>
          </span>
          <span v-else-if="linkingState === 'done'" class="link-row">
            <span class="checkmark">✓</span>
            <span class="link-text">.build/hello: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped</span>
          </span>
        </div>
      </div>

      <!-- Hex button -->
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

      <!-- CTA after completion -->
      <div class="cta-section" :class="{ visible: ctaVisible }">
        <p class="cta-tagline">Congratulations, you wrote your first ChadScript app!</p>
        <div class="cta-buttons">
          <a href="/ChadScript/getting-started/installation" class="cta-link">Get Started</a>
          <a href="/ChadScript/why-chadscript" class="cta-link secondary">Why ChadScript?</a>
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

.hex-section {
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.3s ease, margin 0.3s ease;
}

.hex-section.visible {
  opacity: 1;
  max-height: 110px;
  margin-top: 8px;
}

.hex-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 16px;
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
  width: 56px;
  height: 56px;
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
  text-align: center;
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.4s ease, max-height 0.3s ease, margin 0.3s ease;
}

.cta-section.visible {
  opacity: 1;
  max-height: 200px;
  margin-top: 8px;
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


.stage-link {
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 0;
  max-height: 0;
  overflow: hidden;
  transition: opacity 0.3s ease, max-height 0.3s ease, margin 0.3s ease;
}

.stage-link.visible {
  opacity: 1;
  max-height: 200px;
  margin-top: 8px;
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

@media (max-width: 768px) {
  .ir-showcase {
    padding: 0 16px;
  }

  .terminal-line {
    font-size: 0.72rem;
  }
}
</style>
