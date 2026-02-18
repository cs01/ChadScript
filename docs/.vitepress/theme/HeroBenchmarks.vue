<script setup lang="ts">
import { ref, onMounted } from 'vue'

const entries = [
  { name: 'C', val: '1.7ms', pct: 3, hero: false },
  { name: 'ChadScript', val: '1.9ms', pct: 4, hero: true },
  { name: 'Go', val: '3.7ms', pct: 7, hero: false },
  { name: 'Bun', val: '19ms', pct: 35, hero: false },
  { name: 'Node.js', val: '54ms', pct: 100, hero: false },
]

const visible = ref(false)

onMounted(() => {
  setTimeout(() => { visible.value = true }, 200)
})
</script>

<template>
  <div class="hero-bench" :class="{ visible }">
    <div class="bench-title">Cold Start</div>
    <div class="bench-subtitle">Time to print "Hello" and exit</div>
    <div class="bench-rows">
      <div
        v-for="(e, i) in entries"
        :key="e.name"
        class="bench-row"
      >
        <div class="row-label" :class="{ hero: e.hero }">{{ e.name }}</div>
        <div class="row-track">
          <div
            class="row-bar"
            :class="{ hero: e.hero }"
            :style="{ '--w': e.pct + '%', '--delay': (i * 0.12 + 0.3) + 's' }"
          ></div>
        </div>
        <div class="row-val" :class="{ hero: e.hero }">{{ e.val }}</div>
      </div>
    </div>
    <div class="bench-footer">
      <a href="./benchmarks">All benchmarks →</a>
    </div>
  </div>
</template>

<style scoped>
.hero-bench {
  width: 360px;
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

.bench-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 2px;
}

.bench-subtitle {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  margin-bottom: 16px;
}

.bench-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bench-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
}

.row-label {
  width: 80px;
  text-align: right;
  font-size: 0.8rem;
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
  height: 22px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 5px;
  overflow: hidden;
}

.row-bar {
  height: 100%;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.18);
  width: 0;
  animation: bar-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--delay, 0s);
}

.row-bar.hero {
  background: var(--vp-c-brand-1);
}

.row-val {
  width: 50px;
  font-size: 0.78rem;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.row-val.hero {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.bench-footer {
  margin-top: 14px;
  text-align: center;
}

.bench-footer a {
  font-size: 0.78rem;
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
    max-width: 380px;
    margin: 1rem auto 0;
  }
}
</style>
