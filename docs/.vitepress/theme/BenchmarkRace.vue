<script setup>
import { ref, computed } from 'vue'

const tab = ref('startup')

const benchmarks = {
  startup: {
    desc: 'Time to print \u201cHello, World!\u201d and exit. Average of 50 runs.',
    metric: 'Faster bounce = faster runtime.',
    items: [
      { name: 'C', val: '1.4ms', speed: 0.55, color: 'c' },
      { name: 'ChadScript', val: '1.7ms', speed: 0.6, color: 'chad', hero: true },
      { name: 'Go', val: '3.5ms', speed: 0.8, color: 'go' },
      { name: 'Bun', val: '19.9ms', speed: 1.8, color: 'bun' },
      { name: 'Node.js', val: '57.0ms', speed: 3.1, color: 'node' },
      { name: 'Python', val: '95.2ms', speed: 4.2, color: 'python' },
    ],
    note: 'ChadScript only links what you use \u2014 a hello-world binary has near-zero startup overhead. Go must initialize its runtime and GC. Bun/Node bootstrap their JS engines. Python loads its interpreter.'
  },
  sqlite: {
    desc: '100K SELECT queries on a 100-row in-memory table.',
    metric: 'Faster bounce = higher throughput.',
    items: [
      { name: 'C', val: '434K qps', speed: 0.8, color: 'c' },
      { name: 'Python', val: '356K qps', speed: 0.85, color: 'python' },
      { name: 'ChadScript', val: '314K qps', speed: 0.9, color: 'chad', hero: true },
      { name: 'Bun', val: '176K qps', speed: 1.14, color: 'bun' },
      { name: 'Node.js', val: '151K qps', speed: 1.26, color: 'node' },
    ],
    note: 'ChadScript calls SQLite\u2019s C API directly \u2014 no FFI bridge, no marshaling. Python\u2019s sqlite3 module is decades-old battle-tested C. Both ~2x the JS runtimes.'
  },
  matmul: {
    desc: '512\u00d7512 double-precision matrix multiply (A\u00d7B into C).',
    metric: 'Faster bounce = faster compute.',
    items: [
      { name: 'ChadScript', val: '0.42s', speed: 0.55, color: 'chad', hero: true },
      { name: 'C', val: '0.43s', speed: 0.56, color: 'c' },
      { name: 'Go', val: '0.47s', speed: 0.6, color: 'go' },
      { name: 'Bun', val: '0.59s', speed: 0.72, color: 'bun' },
      { name: 'Node.js', val: '0.61s', speed: 0.75, color: 'node' },
      { name: 'Python', val: '61.3s', speed: 4.5, color: 'python' },
    ],
    note: 'Dense matrix multiply with array element read/write. ChadScript\u2019s arrays go through GC-managed structs, yet opt -O2 eliminates the overhead. Node/Bun\u2019s V8 JIT is strong but can\u2019t match LLVM\u2019s static optimizations here.'
  },
  mandelbrot: {
    desc: 'Mandelbrot set, 4096\u00d74096 grid, max 100 iterations per pixel.',
    metric: 'Faster bounce = faster compute.',
    items: [
      { name: 'ChadScript', val: '1.95s', speed: 0.55, color: 'chad', hero: true },
      { name: 'C', val: '1.98s', speed: 0.56, color: 'c' },
      { name: 'Bun', val: '1.98s', speed: 0.56, color: 'bun' },
      { name: 'Node.js', val: '2.02s', speed: 0.58, color: 'node' },
      { name: 'Go', val: '2.05s', speed: 0.59, color: 'go' },
      { name: 'Python', val: '229.8s', speed: 4.5, color: 'python' },
    ],
    note: 'Pure floating-point compute \u2014 no I/O, no allocations, just math. ChadScript\u2019s LLVM IR + opt -O2 produces code that matches hand-written C. Python is ~118x slower without NumPy.'
  }
}

const current = computed(() => benchmarks[tab.value])
</script>

<template>
<div>
  <div class="bench-tabs">
    <button :class="{ active: tab === 'startup' }" @click="tab = 'startup'">Cold Start</button>
    <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
    <button :class="{ active: tab === 'matmul' }" @click="tab = 'matmul'">Matrix Multiply</button>
    <button :class="{ active: tab === 'mandelbrot' }" @click="tab = 'mandelbrot'">Mandelbrot</button>
  </div>

  <div :key="tab" class="bench-panel">
    <p class="bench-desc">{{ current.desc }} <em>{{ current.metric }}</em></p>
    <div class="race-chart">
      <div v-for="item in current.items" :key="item.name" class="race-row">
        <div class="race-label" :class="{ hero: item.hero }">{{ item.name }}</div>
        <div class="race-track">
          <div class="race-ball" :class="item.color"
               :style="{ '--speed': item.speed + 's' }"></div>
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
.bench-desc { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-bottom: 1.2rem; }
.bench-desc em { color: rgba(255,255,255,0.4); }
.race-chart {
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
  animation: bounce-lr var(--speed) ease-in-out infinite;
  box-shadow: 0 0 8px 2px currentColor;
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
.bench-note {
  margin-top: 1rem;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.35);
  line-height: 1.5;
}
.race-ball.chad { background: #e8a525; color: #e8a525; }
.race-ball.c { background: rgba(255,255,255,0.4); color: rgba(255,255,255,0.2); }
.race-ball.go { background: rgba(255,255,255,0.4); color: rgba(255,255,255,0.2); }
.race-ball.bun { background: rgba(255,255,255,0.4); color: rgba(255,255,255,0.2); }
.race-ball.node { background: rgba(255,255,255,0.4); color: rgba(255,255,255,0.2); }
.race-ball.python { background: rgba(255,255,255,0.4); color: rgba(255,255,255,0.2); }
@keyframes bounce-lr {
  0%, 100% { left: 5px; }
  50% { left: calc(100% - 27px); }
}
</style>
