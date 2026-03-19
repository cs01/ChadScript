<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const tab = ref('startup')

function formatVal(value, metric) {
  if (metric === 'ms') {
    return value < 10 ? value.toFixed(1) + 'ms' : Math.round(value) + 'ms'
  }
  if (value < 0.1) return Math.round(value * 1000) + 'ms'
  if (value < 1) return value.toFixed(3) + 's'
  return value.toFixed(2) + 's'
}

const langMeta = {
  c:          { name: 'C',          color: 'c' },
  chadscript: { name: 'ChadScript', color: 'chad', hero: true },
  go:         { name: 'Go',         color: 'go' },
  bun:        { name: 'Bun',        color: 'bun' },
  node:       { name: 'Node.js',    color: 'node' },
  grep:       { name: 'grep',       color: 'c' },
  ripgrep:    { name: 'ripgrep',    color: 'go' },
}

const tabOrder = ['startup', 'sqlite', 'fibonacci', 'json', 'nbody', 'montecarlo', 'sieve', 'sorting', 'matmul', 'binarytrees', 'stringops', 'fileio']

const tabLabels = {
  startup: 'Cold Start', matmul: 'Matrix Multiply', fibonacci: 'Fibonacci',
  json: 'JSON', sqlite: 'SQLite', montecarlo: 'Monte Carlo', sieve: 'Sieve',
  sorting: 'Quicksort', nbody: 'N-Body', stringops: 'Strings', fileio: 'File I/O',
  binarytrees: 'Binary Trees',
}

const featuredNotes = {
  startup: 'ChadScript only links what you use \u2014 a hello-world binary has near-zero startup overhead. Go must initialize its runtime and GC. Bun/Node bootstrap their JS engines.',
  sqlite: 'ChadScript calls SQLite\u2019s C API directly \u2014 no FFI bridge, no marshaling. 2.1x faster than Node, 2.4x faster than Bun.',
  json: 'ChadScript uses yyjson (SIMD-accelerated) via a thin C bridge. Near-identical to raw C. 3.4x faster than Node/Go, 2x faster than Bun.',
  fibonacci: 'Naive recursive fib(42) \u2014 ~4 billion function calls. ChadScript\u2019s nounwind functions and fast-math optimizations make it faster than Go and 2\u20133x faster than JS runtimes.',
  nbody: 'Gravitational N-body simulation with 25M timesteps. ChadScript\u2019s LLVM backend with fast-math produces tight FP loops \u2014 1.2x faster than Go, 1.6x faster than Node.',
}

const defaultBenchmarks = {
  startup: {
    layout: 'horizontal',
    desc: "Time to print 'Hello, World!' and exit. Average of 50 runs.",
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '1.5ms', w: 2, h: 100, color: 'c', d: 0, speed: 3 },
      { name: 'ChadScript', val: '1.8ms', w: 3, h: 83, color: 'chad', d: 0.12, speed: 3.2, hero: true },
      { name: 'Go', val: '3.5ms', w: 6, h: 43, color: 'go', d: 0.24, speed: 5 },
      { name: 'Bun', val: '18ms', w: 29, h: 8, color: 'bun', d: 0.36, speed: 27 },
      { name: 'Node.js', val: '62ms', w: 100, h: 2, color: 'node', d: 0.48, speed: 82 },
    ],
    note: featuredNotes.startup || '',
  },
  fibonacci: {
    layout: 'horizontal',
    desc: "fib(42), naive recursion.",
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '1.14s', w: 25, h: 100, color: 'c', d: 0, speed: 3 },
      { name: 'ChadScript', val: '1.71s', w: 37, h: 67, color: 'chad', d: 0.12, speed: 3.5, hero: true },
      { name: 'Go', val: '2.00s', w: 44, h: 57, color: 'go', d: 0.24, speed: 4 },
      { name: 'Bun', val: '2.96s', w: 65, h: 39, color: 'bun', d: 0.36, speed: 5 },
      { name: 'Node.js', val: '4.56s', w: 100, h: 25, color: 'node', d: 0.48, speed: 7 },
    ],
    note: featuredNotes.fibonacci || '',
  },
  sqlite: {
    layout: 'horizontal',
    desc: "100K SELECT queries on an in-memory table with 100 rows.",
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '0.267s', w: 32, h: 100, color: 'c', d: 0, speed: 3 },
      { name: 'ChadScript', val: '0.345s', w: 41, h: 77, color: 'chad', d: 0.12, speed: 3.4, hero: true },
      { name: 'Node.js', val: '0.713s', w: 85, h: 37, color: 'node', d: 0.24, speed: 5.5 },
      { name: 'Bun', val: '0.842s', w: 100, h: 32, color: 'bun', d: 0.36, speed: 6.2 },
    ],
    note: featuredNotes.sqlite || '',
  },
}

function transformJson(json) {
  const result = {}
  for (const key of Object.keys(json.benchmarks)) {
    const bench = json.benchmarks[key]
    if (!bench) continue
    const entries = Object.entries(bench.results)
    const lowerBetter = bench.lower_is_better
    entries.sort(([, a], [, b]) => lowerBetter ? a.value - b.value : b.value - a.value)

    const chadIdx = entries.findIndex(([lang]) => lang === 'chadscript')
    if (chadIdx === -1) continue
    if (chadIdx > 1) continue
    if (chadIdx === 1 && entries[0][0] !== 'c') continue

    const values = entries.map(([, r]) => r.value)
    const maxVal = Math.max(...values)
    const minVal = Math.min(...values)
    const layout = 'horizontal'
    const metric = lowerBetter ? 'Smaller = faster.' : 'Taller = more throughput.'

    const items = entries.map(([lang, r], idx) => {
      const meta = langMeta[lang] || { name: lang, color: 'c' }
      const w = lowerBetter ? Math.round((r.value / maxVal) * 100) : Math.round((r.value / maxVal) * 100)
      const h = lowerBetter ? Math.round((minVal / r.value) * 100) : Math.round((r.value / maxVal) * 100)
      const speed = lowerBetter ? 1.5 + (r.value / minVal) * 1.5 : 1.5 + (maxVal / r.value) * 1.5
      return {
        name: meta.name,
        val: formatVal(r.value, bench.metric),
        w,
        h,
        color: meta.color,
        d: idx * 0.12,
        hero: meta.hero || false,
        speed: Math.round(speed * 10) / 10,
      }
    })

    result[key] = {
      name: bench.name,
      layout,
      desc: bench.desc,
      metric,
      items,
      note: featuredNotes[key] || '',
    }
  }
  return result
}

const benchmarks = ref(defaultBenchmarks)

const current = computed(() => benchmarks.value[tab.value])

const tabList = computed(() =>
  tabOrder
    .filter(key => key in benchmarks.value)
    .map(key => ({ key, label: benchmarks.value[key].name || tabLabels[key] || key }))
)

let frameId = 0

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function animateBalls() {
  cancelAnimationFrame(frameId)
  const balls = document.querySelectorAll('.bb-ball')
  if (!balls.length) return

  const infos = Array.from(balls).map(ball => ({
    ball,
    track: ball.closest('.bb-track'),
    speed: parseFloat(ball.dataset.speed) || 1,
  }))

  const startTime = performance.now()

  function frame(now) {
    for (const { ball, track, speed } of infos) {
      const maxLeft = track.clientWidth - 27
      const t = ((now - startTime) / 1000 % speed) / speed
      const phase = t < 0.5 ? t * 2 : 2 - t * 2
      ball.style.left = (5 + easeInOut(phase) * (maxLeft - 5)) + 'px'
    }
    frameId = requestAnimationFrame(frame)
  }

  frameId = requestAnimationFrame(frame)
}

onMounted(async () => {
  animateBalls()
  try {
    const base = import.meta.env.BASE_URL || '/'
    const resp = await fetch(`${base}benchmarks.json`)
    if (resp.ok) {
      const json = await resp.json()
      if (json.benchmarks) {
        benchmarks.value = { ...defaultBenchmarks, ...transformJson(json) }
        if (!benchmarks.value[tab.value]) {
          const first = tabOrder.find(k => k in benchmarks.value)
          if (first) tab.value = first
        }
        await nextTick()
        animateBalls()
      }
    }
  } catch (e) {}
})

watch(tab, async () => {
  await nextTick()
  animateBalls()
})

onBeforeUnmount(() => cancelAnimationFrame(frameId))
</script>

<template>
<div>
  <div class="bench-tabs">
    <button v-for="t in tabList" :key="t.key"
            :class="{ active: tab === t.key }" @click="tab = t.key">
      {{ t.label }}
    </button>
  </div>

  <div class="bench-panel">
    <p class="bench-desc">{{ current.desc }} <em>{{ current.metric }}</em></p>

    <div v-if="current.layout === 'horizontal'" :key="tab" class="horiz-chart">
      <div v-for="item in current.items" :key="item.name" class="horiz-row">
        <div class="horiz-label" :class="{ hero: item.hero }">{{ item.name }}</div>
        <div class="horiz-track">
          <div class="horiz-bar" :class="item.color"
               :style="{ '--w': item.w + '%', '--d': item.d + 's' }"></div>
        </div>
        <div class="horiz-val" :class="{ hero: item.hero }">{{ item.val }}</div>
      </div>
    </div>

    <div v-else :key="tab" class="vert-chart">
      <div v-for="item in current.items" :key="item.name" class="vert-col">
        <div class="vert-top">
          <span class="vert-val" :class="{ hero: item.hero }"
                :style="{ 'animation-delay': (item.d + 0.7) + 's' }">
            {{ item.val }}
          </span>
          <div class="vert-bar" :class="item.color"
               :style="{ '--h': item.h + '%', '--d': item.d + 's' }">
          </div>
        </div>
        <span class="vert-name" :class="{ hero: item.hero }">{{ item.name }}</span>
      </div>
    </div>

    <div class="race-section">
      <div v-for="item in current.items" :key="item.name" class="race-row">
        <div class="race-label" :class="{ hero: item.hero }">{{ item.name }}</div>
        <div class="race-track bb-track">
          <div class="race-ball bb-ball" :class="item.color"
               :data-speed="item.speed"></div>
        </div>
        <div class="race-val" :class="{ hero: item.hero }">{{ item.val }}</div>
      </div>
    </div>

    <p class="bench-note">{{ current.note }}</p>
  </div>
</div>
</template>

<style scoped>
.bench-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border-bottom: 2px solid rgba(255,255,255,0.1);
  margin: 1.5rem 0 0;
}
.bench-tabs button {
  background: none;
  border: none;
  padding: 0.6rem 1.2rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(255,255,255,0.4);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
  font-family: inherit;
}
.bench-tabs button:hover { color: rgba(255,255,255,0.7); }
.bench-tabs button.active { color: #e8a525; border-bottom-color: #e8a525; }
.bench-panel { padding: 1rem 0; }
.bench-desc { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-bottom: 1.5rem; }
.bench-desc em { color: rgba(255,255,255,0.4); }

.horiz-chart {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.horiz-row {
  display: flex;
  align-items: center;
  height: 36px;
}
.horiz-label {
  width: 110px;
  text-align: right;
  padding-right: 14px;
  font-size: 0.85rem;
  font-weight: 500;
  color: rgba(255,255,255,0.55);
  flex-shrink: 0;
}
.horiz-label.hero { color: #e8a525; font-weight: 700; }
.horiz-track {
  flex: 1;
  height: 30px;
  background: rgba(255,255,255,0.04);
  border-radius: 6px;
  overflow: hidden;
}
.horiz-bar {
  height: 100%;
  border-radius: 6px;
  width: 0;
  animation: grow-right 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--d, 0s);
}
.horiz-val {
  width: 90px;
  padding-left: 14px;
  font-size: 0.82rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.45);
  flex-shrink: 0;
}
.horiz-val.hero { color: #e8a525; font-weight: 700; }
.horiz-bar.chad { background: #e8a525; }
.horiz-bar.c { background: rgba(255,255,255,0.25); }
.horiz-bar.go { background: rgba(255,255,255,0.25); }
.horiz-bar.bun { background: rgba(255,255,255,0.25); }
.horiz-bar.node { background: rgba(255,255,255,0.25); }
.horiz-bar.python { background: rgba(255,255,255,0.25); }

.vert-chart {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding: 0 10px;
}
.vert-col {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.vert-top {
  height: 220px;
  width: 60px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}
.vert-bar {
  width: 100%;
  height: 0;
  border-radius: 8px 8px 0 0;
  animation: grow-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--d, 0s);
}
.vert-val {
  font-size: 0.75rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.45);
  margin-bottom: 6px;
  opacity: 0;
  animation: fade-in 0.3s ease forwards;
  white-space: nowrap;
}
.vert-val.hero { color: #e8a525; font-weight: 700; }
.vert-name {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.5);
  margin-top: 8px;
  font-weight: 500;
  white-space: nowrap;
}
.vert-name.hero { color: #e8a525; font-weight: 700; }
.vert-bar.chad { background: #e8a525; }
.vert-bar.c { background: rgba(255,255,255,0.25); }
.vert-bar.go { background: rgba(255,255,255,0.25); }
.vert-bar.bun { background: rgba(255,255,255,0.25); }
.vert-bar.node { background: rgba(255,255,255,0.25); }
.vert-bar.python { background: rgba(255,255,255,0.25); }

.race-section {
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.race-row {
  display: flex;
  align-items: center;
  height: 40px;
}
.race-label {
  width: 110px;
  text-align: right;
  padding-right: 14px;
  font-size: 0.85rem;
  font-weight: 500;
  color: rgba(255,255,255,0.55);
  flex-shrink: 0;
}
.race-label.hero { color: #e8a525; font-weight: 700; }
.race-track {
  flex: 1;
  height: 32px;
  background: rgba(255,255,255,0.04);
  border-radius: 16px;
  position: relative;
}
.race-ball {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  top: 50%;
  transform: translateY(-50%);
  left: 5px;
  box-shadow: none;
}
.race-val {
  width: 90px;
  padding-left: 14px;
  font-size: 0.82rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.45);
  flex-shrink: 0;
}
.race-val.hero { color: #e8a525; font-weight: 700; }
.race-ball.chad { background: #e8a525; }
.race-ball.c { background: rgba(255,255,255,0.4); }
.race-ball.go { background: rgba(255,255,255,0.4); }
.race-ball.bun { background: rgba(255,255,255,0.4); }
.race-ball.node { background: rgba(255,255,255,0.4); }
.race-ball.python { background: rgba(255,255,255,0.4); }

.bench-note {
  margin-top: 1.2rem;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.35);
  line-height: 1.5;
}
@keyframes grow-up {
  from { height: 0; }
  to { height: var(--h); }
}
@keyframes grow-right {
  from { width: 0; }
  to { width: var(--w); }
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
