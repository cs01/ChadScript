<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

interface BenchResult {
  value: number
  label: string
}

interface Benchmark {
  name: string
  desc: string
  metric: string
  lower_is_better: boolean
  results: Record<string, BenchResult>
  place?: number
}

const LANG_NAMES: Record<string, string> = {
  c: 'C',
  chadscript: 'ChadScript',
  go: 'Go',
  node: 'Node.js',
  bun: 'Bun',
  grep: 'grep',
  ripgrep: 'ripgrep',
  wc: 'wc',
  xxd: 'xxd',
  jq: 'jq',
}

const benchmarks = ref<Benchmark[]>([])
const activeIndex = ref(0)
const visible = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const activeBench = computed(() => benchmarks.value[activeIndex.value])

const entries = computed(() => {
  const b = activeBench.value
  if (!b) return []
  const langOrder = ['c', 'chadscript', 'go', 'bun', 'node']
  const sorted = langOrder
    .filter(k => k in b.results)
    .map(k => ({ key: k, ...b.results[k] }))
  if (b.lower_is_better) {
    sorted.sort((a, b2) => a.value - b2.value)
  } else {
    sorted.sort((a, b2) => b2.value - a.value)
  }
  const maxVal = b.lower_is_better
    ? Math.max(...sorted.map(s => s.value))
    : Math.max(...sorted.map(s => s.value))
  return sorted.map(s => ({
    name: LANG_NAMES[s.key] || s.key,
    val: s.label,
    pct: Math.max(3, Math.round((s.value / maxVal) * 100)),
    hero: s.key === 'chadscript',
  }))
})

function selectBench(i: number) {
  activeIndex.value = i
  resetTimer()
}

function resetTimer() {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (benchmarks.value.length > 0) {
      activeIndex.value = (activeIndex.value + 1) % benchmarks.value.length
    }
  }, 4000)
}

onMounted(async () => {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}benchmarks.json`)
    const data = await res.json()
    const all = Object.values(data.benchmarks) as Benchmark[]
    all.sort((a, b2) => (a.place || 99) - (b2.place || 99))
    benchmarks.value = all
  } catch {
    benchmarks.value = []
  }
  setTimeout(() => { visible.value = true }, 200)
  resetTimer()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="hero-bench" :class="{ visible }" v-if="activeBench">
    <div class="bench-header">
      <div class="bench-title">{{ activeBench.name }}</div>
      <div class="bench-place" :class="'place-' + (activeBench.place || 1)">
        {{ activeBench.place === 1 ? '1st' : activeBench.place === 2 ? '2nd' : '3rd' }}
      </div>
    </div>
    <div class="bench-subtitle">{{ activeBench.desc }}</div>
    <div class="bench-rows">
      <div
        v-for="(e, i) in entries"
        :key="activeBench.name + '-' + e.name"
        class="bench-row"
      >
        <div class="row-label" :class="{ hero: e.hero }">{{ e.name }}</div>
        <div class="row-track">
          <div
            class="row-bar"
            :class="{ hero: e.hero }"
            :style="{ '--w': e.pct + '%', '--delay': (i * 0.08 + 0.15) + 's' }"
          ></div>
        </div>
        <div class="row-val" :class="{ hero: e.hero }">{{ e.val }}</div>
      </div>
    </div>
    <div class="bench-tabs" v-if="benchmarks.length > 1">
      <button
        v-for="(b, i) in benchmarks"
        :key="b.name"
        :class="{ active: i === activeIndex }"
        @click="selectBench(i)"
      >{{ b.name }}</button>
    </div>
    <div class="bench-footer">
      <a href="./benchmarks">All benchmarks &rarr;</a>
    </div>
  </div>
</template>

<style scoped>
.hero-bench {
  width: 460px;
  margin: 2.5rem auto 0;
  padding: 22px 24px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--vp-c-bg-soft);
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.hero-bench.visible {
  opacity: 1;
  transform: translateY(0);
}

.bench-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bench-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.bench-place {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  background: rgba(255, 200, 50, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

.bench-place.place-3 {
  color: var(--vp-c-text-2);
  background: rgba(255, 255, 255, 0.06);
}

.bench-subtitle {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  margin-bottom: 14px;
  margin-top: 2px;
}

.bench-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bench-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 26px;
}

.row-label {
  width: 80px;
  text-align: right;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.row-label.hero {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.row-track {
  flex: 1;
  height: 20px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 5px;
  overflow: hidden;
}

.row-bar {
  height: 100%;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.18);
  width: 0;
  animation: bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--delay, 0s);
}

.row-bar.hero {
  background: var(--vp-c-brand-1);
}

.row-val {
  width: 52px;
  font-size: 0.76rem;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.row-val.hero {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.bench-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 14px;
  justify-content: center;
}

.bench-tabs button {
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.bench-tabs button:hover {
  color: var(--vp-c-text-2);
}

.bench-tabs button.active {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: rgba(255, 200, 50, 0.06);
}

.bench-footer {
  margin-top: 12px;
  text-align: center;
}

.bench-footer a {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
  text-decoration: none;
  transition: color 0.15s;
}

.bench-footer a:hover {
  color: var(--vp-c-brand-1);
}

@keyframes bar-grow {
  from { width: 0; }
  to { width: var(--w); }
}

@media (max-width: 960px) {
  .hero-bench {
    width: 100%;
    max-width: 460px;
    margin: 1rem auto 0;
  }
}

@media (max-width: 480px) {
  .bench-tabs button {
    font-size: 0.62rem;
    padding: 2px 6px;
  }
}
</style>
