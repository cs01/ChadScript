<script setup>
import { ref } from 'vue'
const tab = ref('startup')
</script>

<template>
<div>
<div class="bench-tabs">
  <button :class="{ active: tab === 'startup' }" @click="tab = 'startup'">Cold Start</button>
  <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
  <button :class="{ active: tab === 'matmul' }" @click="tab = 'matmul'">Matrix Multiply</button>
  <button :class="{ active: tab === 'mandelbrot' }" @click="tab = 'mandelbrot'">Mandelbrot</button>
</div>

<div v-if="tab === 'startup'" :key="'s'+Date.now()" class="bench-panel">
  <p class="bench-desc">Time to print &quot;Hello, World!&quot; and exit. Average of 50 runs. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.4ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 82%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>1.7ms</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 40%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">3.5ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 7%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">19.9ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 2%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">57.0ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 1%; --d: 0.60s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">95.2ms</div>
    </div>
  </div>
  <p class="bench-note">ChadScript only links what you use — a hello-world binary has near-zero startup overhead. Go must initialize its runtime and GC. Bun/Node bootstrap their JS engines. Python loads its interpreter.</p>
</div>

<div v-if="tab === 'sqlite'" :key="'q'+Date.now()" class="bench-panel">
  <p class="bench-desc">100K <code>SELECT</code> queries on a 100-row in-memory table. <em>Higher is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">434K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 82%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">356K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 72%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>314K qps</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 41%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">176K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 35%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">151K qps</div>
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

<div v-if="tab === 'matmul'" :key="'mm'+Date.now()" class="bench-panel">
  <p class="bench-desc">512&times;512 double-precision matrix multiply (A&times;B into C). <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>0.42s</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">C</div>
      <div class="bench-track">
        <div class="bench-bar c" style="--w: 98%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">0.43s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 89%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">0.47s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 71%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">0.59s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 69%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">0.61s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 1%; --d: 0.60s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">61.3s</div>
    </div>
  </div>
  <p class="bench-note">Dense matrix multiply with array element read/write. ChadScript's arrays go through GC-managed structs, yet opt -O2 eliminates the overhead. Node/Bun's V8 JIT is strong but can't match LLVM's static optimizations here.</p>
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
