<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const tab = ref('startup')

const benchmarks = {
  startup: {
    layout: 'horizontal',
    desc: 'Time to print \u201cHello, World!\u201d and exit. Average of 50 runs.',
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '1.6ms', w: 2, h: 100, color: 'c', d: 0, speed: 1.7 },
      { name: 'ChadScript', val: '1.9ms', w: 2, h: 98, color: 'chad', d: 0.12, hero: true, speed: 1.8 },
      { name: 'Go', val: '3.8ms', w: 4, h: 85, color: 'go', d: 0.24, speed: 2.2 },
      { name: 'Bun', val: '19.5ms', w: 18, h: 40, color: 'bun', d: 0.36, speed: 4.5 },
      { name: 'Node.js', val: '64.7ms', w: 58, h: 22, color: 'node', d: 0.48, speed: 7.8 },
    ],
    note: 'ChadScript only links what you use \u2014 a hello-world binary has near-zero startup overhead. Go must initialize its runtime and GC. Bun/Node bootstrap their JS engines.'
  },
  sqlite: {
    layout: 'vertical',
    desc: '100K SELECT queries on a 100-row in-memory table.',
    metric: 'Taller = more throughput.',
    items: [
      { name: 'C', val: '373K qps', h: 100, color: 'c', d: 0, speed: 2.0 },
      { name: 'ChadScript', val: '332K qps', h: 89, color: 'chad', d: 0.12, hero: true, speed: 2.2 },
      { name: 'Bun', val: '179K qps', h: 48, color: 'bun', d: 0.24, speed: 3.2 },
      { name: 'Node.js', val: '144K qps', h: 39, color: 'node', d: 0.36, speed: 3.8 },
    ],
    note: 'ChadScript calls SQLite\u2019s C API directly \u2014 no FFI bridge, no marshaling. ~2x the JS runtimes.'
  },
  matmul: {
    layout: 'horizontal',
    desc: '512\u00d7512 double-precision matrix multiply (A\u00d7B into C).',
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '0.43s', w: 2, h: 100, color: 'c', d: 0, speed: 1.5 },
      { name: 'ChadScript', val: '0.46s', w: 2, h: 93, color: 'chad', d: 0.12, hero: true, speed: 1.6 },
      { name: 'Go', val: '0.47s', w: 2, h: 91, color: 'go', d: 0.24, speed: 1.7 },
      { name: 'Bun', val: '0.57s', w: 3, h: 75, color: 'bun', d: 0.36, speed: 2.0 },
      { name: 'Node.js', val: '0.60s', w: 3, h: 72, color: 'node', d: 0.48, speed: 2.1 },
    ],
    note: 'Dense matrix multiply with array element read/write. ChadScript\u2019s arrays go through GC-managed structs, yet opt -O2 eliminates the overhead. Node/Bun\u2019s V8 JIT is strong but can\u2019t match LLVM\u2019s static optimizations here.'
  },
  nbody: {
    layout: 'horizontal',
    desc: 'N-Body gravitational simulation: 5 bodies, 50 million steps.',
    metric: 'Smaller = faster.',
    items: [
      { name: 'C', val: '5.04s', w: 2, h: 100, color: 'c', d: 0, speed: 1.5 },
      { name: 'Go', val: '5.77s', w: 3, h: 87, color: 'go', d: 0.12, speed: 1.6 },
      { name: 'Bun', val: '7.90s', w: 8, h: 64, color: 'bun', d: 0.24, speed: 2.0 },
      { name: 'Node.js', val: '8.94s', w: 10, h: 56, color: 'node', d: 0.36, speed: 2.5 },
      { name: 'ChadScript', val: '9.12s', w: 10, h: 55, color: 'chad', d: 0.48, hero: true, speed: 2.6 },
    ],
    note: 'Classic N-Body from the Computer Language Benchmarks Game. Heavy FP arithmetic with array indexing. ChadScript uses GC-managed parallel arrays instead of structs \u2014 the array indirection overhead adds up over 50M iterations.'
  }
}

const current = computed(() => benchmarks[tab.value])

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

onMounted(animateBalls)

watch(tab, async () => {
  await nextTick()
  animateBalls()
})

onBeforeUnmount(() => cancelAnimationFrame(frameId))
</script>

<template>
<div>
  <div class="bench-tabs">
    <button :class="{ active: tab === 'startup' }" @click="tab = 'startup'">Cold Start</button>
    <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
    <button :class="{ active: tab === 'matmul' }" @click="tab = 'matmul'">Matrix Multiply</button>
    <button :class="{ active: tab === 'nbody' }" @click="tab = 'nbody'">N-Body</button>
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
