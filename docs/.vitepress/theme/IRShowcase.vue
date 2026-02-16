<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const activeHighlight = ref<string | null>(null)
const steps = [null, 'log1', 'log2', 'exit'] as const
let stepIndex = 0
let timer: ReturnType<typeof setInterval> | null = null
let hovering = false

function startTimer() {
  if (timer) return
  timer = setInterval(() => {
    if (hovering) return
    stepIndex = (stepIndex + 1) % steps.length
    activeHighlight.value = steps[stepIndex]
  }, 1800)
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function onHover(id: string) {
  hovering = true
  activeHighlight.value = id
}

function onLeave() {
  hovering = false
  stepIndex = steps.indexOf(activeHighlight.value as any)
  if (stepIndex === -1) stepIndex = 0
}

onMounted(() => {
  stepIndex = 1
  activeHighlight.value = steps[stepIndex]
  startTimer()
})

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <div class="ir-showcase">
    <h2 class="ir-heading">What's Under the Hood</h2>
    <p class="ir-subheading">Your TypeScript compiles to LLVM IR — the same backend as clang, Rust, and Swift — then to a native binary. No interpreter. No JIT. No runtime.</p>

    <div class="ir-columns">
      <div class="ir-panel ir-panel-ts">
        <div class="ir-panel-header">
          <span class="ir-dot ir-dot-ts"></span>
          <span class="ir-panel-label">hello.ts</span>
        </div>
        <pre class="ir-code"><code><span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log1' }"
  @mouseenter="onHover('log1')"
  @mouseleave="onLeave"
><span class="ir-builtin">console</span>.<span class="ir-fn">log</span>(<span class="ir-str">"Hello from ChadScript!"</span>);</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log2' }"
  @mouseenter="onHover('log2')"
  @mouseleave="onLeave"
><span class="ir-builtin">console</span>.<span class="ir-fn">log</span>(<span class="ir-str">"This is native code!"</span>);</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'exit' }"
  @mouseenter="onHover('exit')"
  @mouseleave="onLeave"
><span class="ir-builtin">process</span>.<span class="ir-fn">exit</span>(<span class="ir-num">0</span>);</span></code></pre>
      </div>

      <div class="ir-arrow">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M8 20H32M32 20L24 12M32 20L24 28" stroke="var(--vp-c-brand-1)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="ir-arrow-label">chad build -S</span>
      </div>

      <div class="ir-panel ir-panel-ll">
        <div class="ir-panel-header">
          <span class="ir-dot ir-dot-ll"></span>
          <span class="ir-panel-label">hello.ll — LLVM IR</span>
        </div>
        <pre class="ir-code"><code><span class="ir-comment">; string constants compiled into the binary</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log1' }"
  @mouseenter="onHover('log1')"
  @mouseleave="onLeave"
><span class="ir-global">@.str.0</span> = private constant [24 x i8] c<span class="ir-str">"Hello from ChadScript!\0A\00"</span></span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log2' }"
  @mouseenter="onHover('log2')"
  @mouseleave="onLeave"
><span class="ir-global">@.str.1</span> = private constant [22 x i8] c<span class="ir-str">"This is native code!\0A\00"</span></span>

<span class="ir-kw">define</span> i32 <span class="ir-fn">@main</span>(i32 %argc, i8** %argv) {
<span class="ir-label">entry:</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log1' }"
  @mouseenter="onHover('log1')"
  @mouseleave="onLeave"
>  %0 = getelementptr [24 x i8], [24 x i8]* <span class="ir-global">@.str.0</span>, i64 0, i64 0
  <span class="ir-kw">call</span> i32 @<span class="ir-fn">printf</span>(i8* %0)</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'log2' }"
  @mouseenter="onHover('log2')"
  @mouseleave="onLeave"
>  %2 = getelementptr [22 x i8], [22 x i8]* <span class="ir-global">@.str.1</span>, i64 0, i64 0
  <span class="ir-kw">call</span> i32 @<span class="ir-fn">printf</span>(i8* %2)</span>
<span
  class="ir-line"
  :class="{ 'ir-active': activeHighlight === 'exit' }"
  @mouseenter="onHover('exit')"
  @mouseleave="onLeave"
>  <span class="ir-kw">call</span> void @<span class="ir-fn">exit</span>(i32 0)</span>
  ret i32 0
}</code></pre>
      </div>
    </div>

    <div class="ir-legend">
      <span class="ir-legend-item">Watch each line trace from TypeScript to native code</span>
    </div>
  </div>
</template>

<style scoped>
.ir-showcase {
  max-width: 960px;
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

.ir-columns {
  display: flex;
  align-items: stretch;
  gap: 0;
}

.ir-panel {
  flex: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--vp-c-bg-soft);
}

.ir-panel-ts {
  border-top: 3px solid #3b82f6;
}

.ir-panel-ll {
  border-top: 3px solid #f59e0b;
}

.ir-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ir-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.ir-dot-ts {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.ir-dot-ll {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
}

.ir-panel-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}

.ir-code {
  margin: 0;
  padding: 16px;
  font-size: 0.82rem;
  line-height: 1.7;
  overflow-x: auto;
  background: transparent;
}

.ir-code code {
  font-family: var(--vp-font-family-mono);
  background: none;
}

.ir-line {
  display: inline;
  border-radius: 3px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.ir-line.ir-active {
  background: rgba(245, 158, 11, 0.12);
  box-shadow: inset 3px 0 0 var(--vp-c-brand-1);
}

.ir-str { color: #a5d6a7; }
.ir-fn { color: #90caf9; }
.ir-builtin { color: #ce93d8; }
.ir-num { color: #ffcc80; }
.ir-kw { color: #ef9a9a; font-weight: 600; }
.ir-global { color: #80cbc4; }
.ir-comment { color: var(--vp-c-text-3); font-style: italic; }
.ir-label { color: #fff59d; }

.ir-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  flex-shrink: 0;
}

.ir-arrow-label {
  font-size: 0.65rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  white-space: nowrap;
  margin-top: 4px;
}

.ir-legend {
  text-align: center;
  margin-top: 1rem;
}

.ir-legend-item {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}

@media (max-width: 768px) {
  .ir-columns {
    flex-direction: column;
    gap: 8px;
  }

  .ir-arrow {
    padding: 8px 0;
  }

  .ir-arrow svg {
    transform: rotate(90deg);
  }
}
</style>
