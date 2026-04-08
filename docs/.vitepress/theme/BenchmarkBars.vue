<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

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
  xxd: 'xxd',
}

const LANG_ORDER = ['c', 'chadscript', 'go', 'bun', 'node', 'grep', 'ripgrep', 'xxd']

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
  return sorted.map(s => ({
    name: LANG_NAMES[s.key] || s.key,
    val: s.label,
    pct: Math.max(3, Math.round((s.value / maxVal) * 100)),
    hero: s.key === 'chadscript',
    rank: sorted.findIndex(e => e.key === s.key) + 1,
  }))
}

const groups = computed(() => {
  const wins: Benchmark[] = []
  const podium: Benchmark[] = []
  const rest: Benchmark[] = []
  for (const b of benchmarks.value) {
    const entries = sortEntries(b)
    const csRank = entries.find(e => e.hero)?.rank ?? 99
    if (csRank === 1) wins.push(b)
    else if (csRank <= 3) podium.push(b)
    else rest.push(b)
  }
  return { wins, podium, rest }
})

onMounted(async () => {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}benchmarks.json`)
    const data = await res.json()
    const all = Object.values(data.benchmarks) as Benchmark[]
    all.sort((a, b) => {
      const aEntries = sortEntries(a)
      const bEntries = sortEntries(b)
      const aRank = aEntries.find(e => e.hero)?.rank ?? 99
      const bRank = bEntries.find(e => e.hero)?.rank ?? 99
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
    <div class="bench-summary" v-if="benchmarks.length">
      <div class="stat">
        <span class="stat-num">{{ groups.wins.length }}</span>
        <span class="stat-label">1st place</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ groups.wins.length + groups.podium.length }}</span>
        <span class="stat-label">Top 3</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ benchmarks.length }}</span>
        <span class="stat-label">Total</span>
      </div>
    </div>

    <template v-if="groups.wins.length">
      <h2 class="group-title gold">1st Place</h2>
      <div class="bench-grid">
        <div v-for="b in groups.wins" :key="b.name" class="bench-card gold">
          <div class="card-header">
            <span class="card-title">{{ b.name }}</span>
            <span class="card-badge gold">1st</span>
          </div>
          <div class="card-desc">{{ b.desc }}</div>
          <div class="card-rows">
            <div v-for="(e, i) in sortEntries(b)" :key="e.name" class="card-row">
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
    </template>

    <template v-if="groups.podium.length">
      <h2 class="group-title silver">Top 3</h2>
      <div class="bench-grid">
        <div v-for="b in groups.podium" :key="b.name" class="bench-card">
          <div class="card-header">
            <span class="card-title">{{ b.name }}</span>
            <span class="card-badge">Top 3</span>
          </div>
          <div class="card-desc">{{ b.desc }}</div>
          <div class="card-rows">
            <div v-for="(e, i) in sortEntries(b)" :key="e.name" class="card-row">
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
    </template>

    <template v-if="groups.rest.length">
      <h2 class="group-title">All Results</h2>
      <div class="bench-grid">
        <div v-for="b in groups.rest" :key="b.name" class="bench-card muted">
          <div class="card-header">
            <span class="card-title">{{ b.name }}</span>
          </div>
          <div class="card-desc">{{ b.desc }}</div>
          <div class="card-rows">
            <div v-for="(e, i) in sortEntries(b)" :key="e.name" class="card-row">
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
    </template>
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

.bench-summary {
  display: flex;
  gap: 32px;
  justify-content: center;
  margin-bottom: 32px;
  padding: 20px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-num {
  font-size: 2rem;
  font-weight: 800;
  color: var(--vp-c-brand-1);
  line-height: 1;
}

.stat-label {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.group-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 28px 0 12px;
  color: var(--vp-c-text-2);
}

.group-title.gold {
  color: var(--vp-c-brand-1);
}

.group-title.silver {
  color: var(--vp-c-text-1);
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

.bench-card.gold {
  border-color: rgba(255, 200, 50, 0.2);
}

.bench-card.gold:hover {
  border-color: rgba(255, 200, 50, 0.35);
}

.bench-card.muted {
  opacity: 0.8;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.card-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.card-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--vp-c-text-2);
}

.card-badge.gold {
  background: rgba(255, 200, 50, 0.12);
  color: var(--vp-c-brand-1);
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
  .bench-summary {
    gap: 20px;
  }
}
</style>
