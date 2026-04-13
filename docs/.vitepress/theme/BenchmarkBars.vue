<script setup lang="ts">
import { ref, onMounted } from 'vue'

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
}

const LANG_NAMES: Record<string, string> = {
  c: 'C',
  chadscript: 'ChadScript',
  go: 'Go',
  node: 'Node.js',
  grep: 'grep',
  ripgrep: 'ripgrep',
  xxd: 'xxd',
}

const LANG_ORDER = ['c', 'chadscript', 'go', 'node', 'grep', 'ripgrep', 'xxd']

const benchmarks = ref<Benchmark[]>([])
const visible = ref(false)

function sortEntries(b: Benchmark) {
  const known = new Set(LANG_ORDER)
  const sorted = LANG_ORDER
    .filter(k => k in b.results)
    .map(k => ({ key: k, ...b.results[k] }))
  for (const k of Object.keys(b.results)) {
    if (!known.has(k)) sorted.push({ key: k, ...b.results[k] })
  }
  if (b.lower_is_better) {
    sorted.sort((a, b2) => a.value - b2.value)
  } else {
    sorted.sort((a, b2) => b2.value - a.value)
  }
  const maxVal = Math.max(...sorted.map(s => s.value))
  return sorted.map(s => {
    const unit = b.metric === 'ms' ? 'ms' : 's'
    const formatted = s.value.toFixed(3) + unit
    return {
      name: LANG_NAMES[s.key] || s.key,
      val: formatted,
      pct: Math.max(3, Math.round((s.value / maxVal) * 100)),
      hero: s.key === 'chadscript',
    }
  })
}

onMounted(async () => {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}benchmarks.json`)
    const data = await res.json()
    const all = Object.values(data.benchmarks) as Benchmark[]
    all.sort((a, b) => {
      const aEntries = sortEntries(a)
      const bEntries = sortEntries(b)
      const aRank = aEntries.findIndex(e => e.hero)
      const bRank = bEntries.findIndex(e => e.hero)
      return aRank - bRank
    })
    benchmarks.value = all
  } catch {
    benchmarks.value = []
  }
  setTimeout(() => { visible.value = true }, 100)
})
</script>

<template>
  <div class="bench-page" :class="{ visible }">
    <div class="bench-grid">
      <div v-for="b in benchmarks" :key="b.name" class="bench-card">
        <div class="card-header">
          <span class="card-title">{{ b.name }}</span>
        </div>
        <div class="card-desc">{{ b.desc }}</div>
        <div class="card-rows">
          <div v-for="e in sortEntries(b)" :key="e.name" class="card-row">
            <div class="card-label" :class="{ hero: e.hero }">{{ e.name }}</div>
            <div class="card-track">
              <div
                class="card-bar"
                :class="{ hero: e.hero }"
                :style="{ width: e.pct + '%' }"
              ></div>
            </div>
            <div class="card-val" :class="{ hero: e.hero }">{{ e.val }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bench-page {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.bench-page.visible {
  opacity: 1;
  transform: translateY(0);
}

.bench-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.bench-card {
  padding: 18px 20px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: border-color 0.2s;
}

.bench-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
}

.card-header {
  margin-bottom: 2px;
}

.card-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.card-desc {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  margin-bottom: 12px;
}

.card-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
}

.card-label {
  width: 72px;
  text-align: right;
  font-size: 0.74rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.card-label.hero {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.card-track {
  flex: 1;
  height: 16px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
  overflow: hidden;
}

.card-bar {
  height: 100%;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.15);
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.card-bar.hero {
  background: var(--vp-c-brand-1);
}

.card-val {
  width: 52px;
  font-size: 0.72rem;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.card-val.hero {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

@media (max-width: 480px) {
  .bench-grid {
    grid-template-columns: 1fr;
  }
}
</style>
