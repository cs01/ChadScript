<script setup>
import { ref } from 'vue'
const tab = ref('startup')
</script>

<template>
<div>
<div class="bench-tabs">
  <button :class="{ active: tab === 'startup' }" @click="tab = 'startup'">Cold Start</button>
  <button :class="{ active: tab === 'mandelbrot' }" @click="tab = 'mandelbrot'">Mandelbrot</button>
  <button :class="{ active: tab === 'fibonacci' }" @click="tab = 'fibonacci'">Fibonacci</button>
  <button :class="{ active: tab === 'json' }" @click="tab = 'json'">JSON</button>
  <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
</div>

<div v-if="tab === 'startup'" :key="'s'+Date.now()" class="bench-panel">
  <p class="bench-desc">Time to print &quot;Hello, World!&quot; and exit. Average of 50 runs. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.5ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 88%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>1.7ms</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 43%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">3.5ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 8%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">19.4ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 3%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">55.0ms</div>
    </div>
  </div>
  <p class="bench-note">ChadScript only links what you use — a hello-world binary has near-zero startup overhead. Go must initialize its runtime and GC. Bun/Node bootstrap their JS engines.</p>
</div>

<div v-if="tab === 'sqlite'" :key="'q'+Date.now()" class="bench-panel">
  <p class="bench-desc">100K <code>SELECT</code> queries on a 100-row in-memory table. <em>Higher is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">407K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 71%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>288K qps</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 38%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">155K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 30%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">122K qps</div>
    </div>
  </div>
  <p class="bench-note">ChadScript calls SQLite's C API directly — no FFI bridge, no marshaling. Python's <code>sqlite3</code> module is decades-old battle-tested C. Both ~2x the JS runtimes.</p>
</div>

<div v-if="tab === 'mandelbrot'" :key="'m'+Date.now()" class="bench-panel">
  <p class="bench-desc">Mandelbrot set, 4096&times;4096 grid, max 100 iterations per pixel. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>1.95s</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 98%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.98s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 98%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.98s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 97%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">2.02s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 95%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">2.05s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 1%; --d: 0.60s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">229.8s</div>
    </div>
  </div>
  <p class="bench-note">Pure floating-point compute — no I/O, no allocations, just math. ChadScript's LLVM IR + opt -O2 produces code that matches hand-written C. Python is ~118x slower without NumPy.</p>
</div>

<div v-if="tab === 'json'" :key="'j'+Date.now()" class="bench-panel">
  <p class="bench-desc">Parse + stringify 10,000 JSON objects (4 fields each). <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">6ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 67%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>8ms</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 60%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">10ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 26%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">23ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 18%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">33ms</div>
    </div>
  </div>
  <p class="bench-note">ChadScript uses yyjson (SIMD-accelerated) via a thin C bridge. Near-identical to raw C performance. Go's encoding/json uses reflection. Bun/Node rely on V8's built-in JSON parser.</p>
</div>

<div v-if="tab === 'fibonacci'" :key="'f'+Date.now()" class="bench-panel">
  <p class="bench-desc">Naive recursive fib(42) &mdash; ~4 billion function calls. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.04s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 61%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>1.7s</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 57%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.81s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 34%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">3.06s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 23%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">4.61s</div>
    </div>
  </div>
  <p class="bench-note">Pure function-call overhead benchmark. ChadScript's nounwind functions and LLVM fast-math optimizations make it faster than Go and 2-3x faster than JS runtimes.</p>
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
.bench-tabs button:hover {
  color: rgba(255,255,255,0.7);
}
.bench-tabs button.active {
  color: #e8a525;
  border-bottom-color: #e8a525;
}
.bench-panel {
  padding: 1rem 0;
}
.bench-desc {
  color: rgba(255,255,255,0.6);
  font-size: 0.9rem;
  margin-bottom: 1.2rem;
}
.bench-desc em {
  color: rgba(255,255,255,0.4);
}
.bench-chart {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.bench-row {
  display: flex;
  align-items: center;
  height: 36px;
}
.bench-label {
  width: 110px;
  text-align: right;
  padding-right: 14px;
  font-size: 0.85rem;
  font-weight: 500;
  color: rgba(255,255,255,0.55);
  flex-shrink: 0;
}
.chad-label {
  color: #e8a525 !important;
  font-weight: 700 !important;
}
.bench-track {
  flex: 1;
  height: 30px;
  background: rgba(255,255,255,0.04);
  border-radius: 6px;
  overflow: visible;
  position: relative;
}
.bench-bar {
  height: 100%;
  border-radius: 6px;
  position: relative;
  width: 0;
  animation: bench-race 1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--d, 0s);
}
.bench-ball {
  position: absolute;
  right: -9px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: inherit;
  border: 2.5px solid rgba(255,255,255,0.85);
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.bench-val {
  width: 90px;
  padding-left: 20px;
  font-size: 0.82rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.45);
  flex-shrink: 0;
}
.bench-val strong {
  color: #e8a525;
}
.bench-note {
  margin-top: 1rem;
  font-size: 0.8rem;
  color: rgba(255,255,255,0.35);
  line-height: 1.5;
}
@keyframes bench-race {
  0% { width: 0; }
  85% { width: calc(var(--w) + 1.5%); }
  100% { width: var(--w); }
}
.bench-bar.chad { background: #e8a525; }
.bench-bar.c { background: rgba(255,255,255,0.25); }
.bench-bar.go { background: rgba(255,255,255,0.25); }
.bench-bar.bun { background: rgba(255,255,255,0.25); }
.bench-bar.node { background: rgba(255,255,255,0.25); }
.bench-bar.python { background: rgba(255,255,255,0.25); }
</style>
