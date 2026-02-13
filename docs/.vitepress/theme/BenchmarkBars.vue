<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

const tab = ref('startup')

const benchmarks = {
  startup: {
    layout: 'horizontal',
    desc: 'Time to print \u201cHello, World!\u201d and exit. Average of 50 runs.',
    metric: 'Smaller = faster.',
    items: [
      { name: 'Go', val: '3.5ms', w: 4, h: 100, color: 'go', d: 0, speed: 2.0 },
      { name: 'ChadScript', val: '5.9ms', w: 6, h: 77, color: 'chad', d: 0.12, hero: true, speed: 2.5 },
      { name: 'Bun', val: '17.6ms', w: 19, h: 45, color: 'bun', d: 0.24, speed: 4.5 },
      { name: 'Node.js', val: '52.7ms', w: 56, h: 26, color: 'node', d: 0.36, speed: 7.8 },
      { name: 'Python', val: '94.6ms', w: 100, h: 19, color: 'python', d: 0.48, speed: 10.5 },
    ],
    note: 'ChadScript and Go are precompiled native binaries \u2014 no runtime to bootstrap. Bun/Node must initialize their JS engines. Python loads its interpreter.'
  },
  fib: {
    layout: 'horizontal',
    desc: 'Recursive fib(42), no memoization. Pure function-call + arithmetic overhead.',
    metric: 'Smaller = faster.',
    items: [
      { name: 'Go', val: '1.93s', w: 3, h: 100, color: 'go', d: 0, speed: 2.0 },
      { name: 'ChadScript', val: '2.11s', w: 3, h: 96, color: 'chad', d: 0.12, hero: true, speed: 2.1 },
      { name: 'Bun', val: '2.69s', w: 4, h: 85, color: 'bun', d: 0.24, speed: 2.35 },
      { name: 'Node.js', val: '4.41s', w: 7, h: 66, color: 'node', d: 0.36, speed: 3.0 },
      { name: 'Python', val: '61.3s', w: 100, h: 18, color: 'python', d: 0.48, speed: 11.0 },
    ],
    note: 'ChadScript compiles to LLVM IR with the same optimizations as clang/C++. Go\u2019s edge comes from native int64 \u2014 ChadScript uses double for all numbers.'
  },
  sqlite: {
    layout: 'vertical',
    desc: '100K SELECT queries on a 100-row in-memory table.',
    metric: 'Taller = more throughput.',
    items: [
      { name: 'Python', val: '348K qps', h: 100, color: 'python', d: 0, speed: 2.0 },
      { name: 'ChadScript', val: '322K qps', h: 96, color: 'chad', d: 0.12, hero: true, speed: 2.08 },
      { name: 'Bun', val: '171K qps', h: 70, color: 'bun', d: 0.24, speed: 2.85 },
      { name: 'Node.js', val: '141K qps', h: 64, color: 'node', d: 0.36, speed: 3.15 },
    ],
    note: 'ChadScript calls SQLite\u2019s C API directly \u2014 no FFI bridge, no marshaling. Python\u2019s sqlite3 module is decades-old battle-tested C. Both ~2x the JS runtimes.'
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
    <button :class="{ active: tab === 'fib' }" @click="tab = 'fib'">Fibonacci(42)</button>
    <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
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
    <p class="bench-details"><a href="https://github.com/cssmith36/ChadScript/tree/main/benchmarks" target="_blank">details &rarr;</a></p>
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
.bench-details {
  margin-top: 0.5rem;
  font-size: 0.8rem;
}
.bench-details a {
  color: rgba(255,255,255,0.35);
  text-decoration: none;
  transition: color 0.2s;
}
.bench-details a:hover { color: rgba(255,255,255,0.6); }
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
