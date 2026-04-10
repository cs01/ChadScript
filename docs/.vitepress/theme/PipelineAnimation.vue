<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const containerRef = ref<HTMLElement | null>(null)
const phase = ref(0)
const analyzeIdx = ref(-1)
let observer: IntersectionObserver | null = null
let timeouts: ReturnType<typeof setTimeout>[] = []
let started = false

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    timeouts.push(t)
  })
}

const codeLines = [
  { text: 'function app(n: number): number {', color: '#c792ea' },
  { text: '  if (n <= 1) return n;', color: '#89ddff' },
  { text: '  return app(n-1) + app(n-2);', color: '#f78c6c' },
  { text: '}', color: '#c792ea' },
  { text: 'console.log(app(42));', color: '#82aaff' },
]

const blocks = [
  { id: 0, line: 0, label: 'FunctionDecl', ir: 'define i64 @app(i64 %n) {', left: 0,  width: 100 },
  { id: 1, line: 1, label: 'IfStmt',       ir: '  %cmp = icmp sle i64 %n, 1', left: 0,  width: 55 },
  { id: 2, line: 1, label: 'ReturnExpr',   ir: '  br i1 %cmp, label %b, %r',  left: 58, width: 42 },
  { id: 3, line: 2, label: 'CallExpr',     ir: '  %a = call i64 @app(%n-1)',   left: 0,  width: 38 },
  { id: 4, line: 2, label: 'BinaryAdd',    ir: '  %s = add nsw i64 %a, %b',    left: 40, width: 22 },
  { id: 5, line: 2, label: 'CallExpr',     ir: '  %b = call i64 @app(%n-2)',   left: 64, width: 36 },
  { id: 6, line: 3, label: 'ReturnStmt',   ir: '  ret i64 %s',                 left: 0,  width: 100 },
  { id: 7, line: 4, label: 'CallExpr',     ir: '}',                            left: 0,  width: 100 },
]

// Phases:
// 1    code types in
// 2    AST rects fade in over code
// 3    crossfade to blocks grid (parse)
// 4    blocks settled in grid
// 5    analyze: flash ALL blocks in sequence, all glow green
// 6    blocks animate from grid → single column stack
// 7    labels crossfade from AST → IR (blocks become .ll code)
// 8    column shrinks, cube appears
// 9    cube spinning
// 10   done

const step = ref('')
const stepDesc = ref('')

const stepDescriptions: Record<string, string> = {
  source: 'Your TypeScript source code',
  parse: 'Breaking code into an abstract syntax tree',
  analyze: 'Resolving types and checking semantics',
  codegen: 'Lowering to LLVM intermediate representation',
  link: 'Compiling and linking into a native binary',
}

async function run() {
  if (started) return
  started = true

  step.value = 'source'
  stepDesc.value = stepDescriptions.source
  phase.value = 1
  await delay(2400)
  phase.value = 2
  await delay(3000)

  step.value = 'parse'
  stepDesc.value = stepDescriptions.parse
  phase.value = 3
  await delay(1000)
  phase.value = 4
  await delay(1600)

  step.value = 'analyze'
  stepDesc.value = stepDescriptions.analyze
  phase.value = 5
  for (let i = 0; i < blocks.length; i++) {
    analyzeIdx.value = i
    await delay(450)
  }
  analyzeIdx.value = blocks.length
  await delay(600)
  analyzeIdx.value = 99
  await delay(1000)

  step.value = 'codegen'
  stepDesc.value = stepDescriptions.codegen
  phase.value = 6
  await delay(2000)
  phase.value = 7
  await delay(3500)

  step.value = 'link'
  stepDesc.value = stepDescriptions.link
  phase.value = 8 // column converges + cube emerges together
  await delay(400)
  phase.value = 9 // cube growing while column still shrinking
  await delay(1200)
  phase.value = 10 // cube spinning
  await delay(600)

  phase.value = 11
}

function replay() {
  timeouts.forEach(t => clearTimeout(t))
  timeouts = []
  phase.value = 0
  analyzeIdx.value = -1
  step.value = ''
  stepDesc.value = ''
  started = false
  setTimeout(() => run(), 300)
}

onMounted(() => {
  nextTick(() => {
    if (!containerRef.value) return
    observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !started) run() },
      { threshold: 0.25 }
    )
    observer.observe(containerRef.value)
  })
})

onUnmounted(() => {
  if (observer) observer.disconnect()
  timeouts.forEach(t => clearTimeout(t))
})

const steps = ['source', 'parse', 'analyze', 'codegen', 'link']
const stepLabels: Record<string, string> = {
  source: 'SOURCE', parse: 'PARSE', analyze: 'ANALYZE', codegen: 'CODEGEN', link: 'LINK'
}

function stepState(s: string) {
  const ci = steps.indexOf(step.value)
  const si = steps.indexOf(s)
  if (si < ci) return 'done'
  if (si === ci) return 'active'
  return 'pending'
}
</script>

<template>
  <div class="pipeline-wrap" ref="containerRef">
    <div class="theater">

      <div class="breadbar" :class="{ show: phase >= 1 }">
        <template v-for="(s, i) in steps" :key="s">
          <div class="crumb" :class="stepState(s)">
            <span class="crumb-dot"></span>
            <span class="crumb-text">{{ stepLabels[s] }}</span>
          </div>
          <div v-if="i < steps.length - 1" class="crumb-line" :class="{ lit: steps.indexOf(step) > i }"></div>
        </template>
      </div>

      <div class="step-desc" :class="{ show: stepDesc }" :key="stepDesc">{{ stepDesc }}</div>

      <div class="content">

        <!-- SOURCE: code with AST overlays -->
        <div class="scene" :class="{ show: phase >= 1 && phase <= 2 }">
          <div v-for="(line, li) in codeLines" :key="li" class="code-row">
            <div class="code-text"
              :class="{ typed: phase >= 1 }"
              :style="{ color: line.color, animationDelay: (li * 0.1) + 's' }"
            >{{ line.text }}</div>
            <div
              v-for="b in blocks.filter(b2 => b2.line === li)"
              :key="'r-' + b.id"
              class="highlight-rect"
              :class="{ growing: phase >= 2 }"
              :style="{ left: b.left + '%', width: b.width + '%', '--rect-delay': (b.id * 0.12) + 's' }"
            >
              <span class="rect-label" :class="{ show: phase >= 2 }">{{ b.label }}</span>
            </div>
          </div>
        </div>

        <!-- PARSE → ANALYZE → CODEGEN → LINK: one continuous scene -->
        <div class="scene" :class="{ show: phase >= 3 }">

          <!-- Blocks (grid → column → converge to center) -->
          <div class="blocks-container" :class="{
            grid: phase >= 3 && phase < 6,
            column: phase >= 6 && phase < 8,
            converge: phase >= 8,
          }">
            <div
              v-for="(b, i) in blocks"
              :key="'b-' + b.id"
              class="block"
              :class="{
                pop: phase >= 3,
                scanning: phase === 5 && analyzeIdx === i,
                scanned: phase === 5 && analyzeIdx > i && analyzeIdx !== 99,
                checked: phase === 5 && analyzeIdx >= 99,
                stacked: phase >= 6,
                'ir-mode': phase >= 7,
              }"
              :style="{ '--d': (i * 0.05) + 's' }"
            >
              <span class="label-ast" :class="{ hide: phase >= 7 }">{{ b.label }}</span>
              <span class="label-ir" :class="{ show: phase >= 7 }">{{ b.ir }}</span>
            </div>
          </div>

          <!-- Cube emerges from the convergence point -->
          <div class="cube-emerge" :class="{ show: phase >= 9, growing: phase === 8 }">
            <div class="cube-row" @click="replay" title="Click to replay">
              <div class="cube-wrapper">
                <div class="cube" :class="{ spin: phase >= 10 }">
                  <div class="face front"><div class="face-inner"></div></div>
                  <div class="face back"><div class="face-inner"></div></div>
                  <div class="face left"><div class="face-inner"></div></div>
                  <div class="face right"><div class="face-inner"></div></div>
                  <div class="face top"><div class="face-inner"></div></div>
                  <div class="face bottom"><div class="face-inner"></div></div>
                </div>
              </div>
              <div class="cube-info">
                <div class="cube-name">app</div>
                <div class="cube-detail">standalone native binary</div>
                <div class="cube-stats">247 KB &middot; 0.8ms cold start</div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>

    <div class="caption" :class="{ show: phase >= 11 }">
      Same LLVM optimization passes as C, Rust, and Swift. No VM, no JIT — just machine code.
    </div>
  </div>
</template>

<style scoped>
.pipeline-wrap {
  max-width: 700px;
  margin: 1.5rem auto 0;
  padding: 0 24px;
}

.theater {
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(0,0,0,0.3);
  overflow: hidden;
}

/* ---- Breadcrumb ---- */
.breadbar {
  display: flex; align-items: center; justify-content: center;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  opacity: 0; transition: opacity 0.4s ease;
}
.breadbar.show { opacity: 1; }

.crumb {
  display: flex; align-items: center; gap: 5px;
  opacity: 0.35; transition: opacity 0.35s ease;
}
.crumb.active { opacity: 1; }
.crumb.done { opacity: 0.6; }

.crumb-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255,255,255,0.25);
  transition: background 0.3s ease, box-shadow 0.3s ease;
}
.crumb.active .crumb-dot {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 8px rgba(255,200,50,0.5);
}
.crumb.done .crumb-dot { background: rgba(255,255,255,0.35); }

.crumb-text {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em;
  color: var(--vp-c-text-2); transition: color 0.3s ease;
}
.crumb.active .crumb-text { color: var(--vp-c-text-1); }

.crumb-line {
  width: 24px; height: 1px; margin: 0 8px;
  background: rgba(255,255,255,0.15); transition: background 0.4s ease;
}
.crumb-line.lit { background: rgba(255,200,50,0.4); }

/* ---- Step description ---- */
.step-desc {
  text-align: center; font-size: 0.85rem;
  color: var(--vp-c-text-2);
  padding: 0 16px 6px; min-height: 20px;
  opacity: 0; transition: opacity 0.4s ease;
}
.step-desc.show { opacity: 1; }

/* ---- Content ---- */
.content {
  position: relative; height: 210px; padding: 6px 20px;
}

.scene {
  position: absolute; inset: 0; padding: 10px 20px;
  opacity: 0; transition: opacity 0.5s ease;
  pointer-events: none;
}
.scene.show { opacity: 1; }

/* ---- Source: code + rects ---- */
.code-row {
  position: relative; height: 28px; margin-bottom: 2px;
}

.code-text {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem; line-height: 28px;
  white-space: pre; opacity: 0;
  z-index: 1; position: relative;
}
.code-text.typed { animation: fade-up 0.25s ease forwards; }

@keyframes fade-up {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.highlight-rect {
  position: absolute; top: 1px; height: 26px;
  border: 1.5px solid transparent;
  border-radius: 4px; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
}

.highlight-rect.growing {
  animation: rect-grow 1.2s ease forwards;
  animation-delay: var(--rect-delay);
}

@keyframes rect-grow {
  0%   { opacity: 0; border-color: rgba(255,255,255,0); background: rgba(30,30,30,0); }
  30%  { opacity: 0.5; border-color: rgba(255,255,255,0.2); background: rgba(30,30,30,0.7); }
  60%  { opacity: 0.8; border-color: rgba(255,255,255,0.4); background: rgba(30,30,30,0.9); }
  100% { opacity: 1; border-color: rgba(255,255,255,0.5); background: rgba(30,30,30,1); }
}

.rect-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem; white-space: nowrap;
  color: transparent;
  transition: color 0.6s ease 0.6s;
}
.rect-label.show { color: rgba(255,255,255,0.85); }

/* ---- Blocks container: grid ↔ column via CSS ---- */
.blocks-container {
  transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.blocks-container.grid {
  display: flex; flex-wrap: wrap; gap: 8px;
  justify-content: center; align-content: flex-start;
  padding-top: 6px;
}

.blocks-container.column {
  display: flex; flex-direction: column; gap: 2px;
  align-items: flex-start;
  padding-top: 2px;
  transform-origin: center center;
  transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.blocks-container.converge {
  align-items: center;
  transform: scale(0);
  opacity: 0;
  filter: blur(8px);
  gap: 0;
  transition: all 0.9s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ---- Block ---- */
.block {
  height: 32px; padding: 0 14px;
  border-radius: 5px;
  border: 1.5px solid rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.05);
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  display: flex; align-items: center;
  white-space: nowrap; position: relative;
  opacity: 0; transform: translateY(12px) scale(0.85);
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.block.pop {
  opacity: 1; transform: translateY(0) scale(1);
  transition-delay: var(--d);
}

.block.scanning {
  border-color: rgba(140,230,140,0.8);
  background: rgba(140,230,140,0.15);
  box-shadow: 0 0 16px rgba(140,230,140,0.3);
  transform: scale(1.04);
  z-index: 2;
}

.block.scanned {
  border-color: rgba(140,230,140,0.5);
  background: rgba(140,230,140,0.08);
}

.block.checked {
  border-color: rgba(140,230,140,0.5);
  background: rgba(140,230,140,0.08);
}

.block.stacked {
  height: 22px; padding: 0 8px;
  border-radius: 3px;
  border-color: rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.03);
  width: 100%;
  font-size: 0.78rem;
}

.block.ir-mode {
  border-color: rgba(100,200,255,0.25);
  background: rgba(100,200,255,0.04);
}

/* Crossfading labels */
.label-ast, .label-ir {
  transition: opacity 0.6s ease;
}

.label-ast {
  color: rgba(255,255,255,0.85);
  opacity: 1;
}
.label-ast.hide { opacity: 0; position: absolute; }

.label-ir {
  color: rgba(100,200,255,0.9);
  opacity: 0;
  white-space: pre;
}
.label-ir.show { opacity: 1; }

/* ---- Cube emerge (from convergence point) ---- */
.cube-emerge {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0);
  transition: all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  pointer-events: none;
}

.cube-emerge.growing {
  opacity: 0.3;
  transform: scale(0.4);
}

.cube-emerge.show {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

/* ---- Cube ---- */
.cube-row {
  display: flex; align-items: center; justify-content: center;
  gap: 28px; height: 100%;
  cursor: pointer; pointer-events: auto;
}

.cube-wrapper {
  width: 80px; height: 80px;
  perspective: 300px; flex-shrink: 0;
}

.cube {
  width: 80px; height: 80px;
  position: relative;
  transform-style: preserve-3d;
  transform: rotateX(-25deg) rotateY(35deg);
}

.cube.spin { animation: cube-rotate 12s linear infinite; }

@keyframes cube-rotate {
  from { transform: rotateX(-25deg) rotateY(35deg); }
  to { transform: rotateX(-25deg) rotateY(395deg); }
}

.face {
  position: absolute; width: 80px; height: 80px;
  border: 1.5px solid rgba(255,200,50,0.3);
}

.face-inner {
  position: absolute; inset: 7px;
  border: 1px solid rgba(255,200,50,0.12);
  border-radius: 2px;
  background: linear-gradient(135deg, rgba(255,200,50,0.06), rgba(255,200,50,0.02));
}

.front  { transform: translateZ(40px); background: rgba(255,200,50,0.05); }
.back   { transform: rotateY(180deg) translateZ(40px); background: rgba(255,200,50,0.03); }
.left   { transform: rotateY(-90deg) translateZ(40px); background: rgba(255,200,50,0.04); }
.right  { transform: rotateY(90deg) translateZ(40px); background: rgba(255,200,50,0.04); }
.top    { transform: rotateX(90deg) translateZ(40px); background: rgba(255,200,50,0.06); }
.bottom { transform: rotateX(-90deg) translateZ(40px); background: rgba(255,200,50,0.02); }

.cube-info { text-align: left; }

.cube-name {
  font-family: var(--vp-font-family-mono);
  font-size: 1.1rem; font-weight: 700;
  color: var(--vp-c-text-1);
}

.cube-detail {
  font-size: 0.82rem; color: var(--vp-c-text-2); margin-top: 4px;
}

.cube-stats {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem; color: var(--vp-c-text-2); margin-top: 6px;
}

/* ---- Caption ---- */
.caption {
  text-align: center; font-size: 0.9rem;
  color: var(--vp-c-text-1); margin-top: 1rem;
  opacity: 0; transform: translateY(6px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.caption.show { opacity: 1; transform: translateY(0); }

/* ---- Responsive ---- */
@media (max-width: 640px) {
  .content { height: 190px; }
  .code-text { font-size: 0.68rem; }
  .block { height: 28px; font-size: 0.64rem; }
  .block.stacked { height: 20px; font-size: 0.68rem; }
  .cube-wrapper, .cube { width: 60px; height: 60px; }
  .face { width: 60px; height: 60px; }
  .front  { transform: translateZ(30px); }
  .back   { transform: rotateY(180deg) translateZ(30px); }
  .left   { transform: rotateY(-90deg) translateZ(30px); }
  .right  { transform: rotateY(90deg) translateZ(30px); }
  .top    { transform: rotateX(90deg) translateZ(30px); }
  .bottom { transform: rotateX(-90deg) translateZ(30px); }
  .crumb-line { width: 16px; margin: 0 4px; }
}

@media (max-width: 420px) {
  .content { height: 170px; }
  .block { height: 24px; padding: 0 8px; font-size: 0.56rem; }
  .block.stacked { height: 18px; font-size: 0.58rem; }
  .blocks-container.grid { gap: 5px; }
  .cube-wrapper, .cube { width: 50px; height: 50px; }
  .face { width: 50px; height: 50px; }
  .front  { transform: translateZ(25px); }
  .back   { transform: rotateY(180deg) translateZ(25px); }
  .left   { transform: rotateY(-90deg) translateZ(25px); }
  .right  { transform: rotateY(90deg) translateZ(25px); }
  .top    { transform: rotateX(90deg) translateZ(25px); }
  .bottom { transform: rotateX(-90deg) translateZ(25px); }
  .crumb-text { font-size: 0.5rem; }
  .crumb-line { width: 10px; margin: 0 3px; }
}
</style>
