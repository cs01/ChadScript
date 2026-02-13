<script setup>
import { ref } from 'vue'
const tab = ref('startup')
</script>

<template>
<div>
<div class="bench-tabs">
  <button :class="{ active: tab === 'startup' }" @click="tab = 'startup'">Cold Start</button>
  <button :class="{ active: tab === 'fib' }" @click="tab = 'fib'">Fibonacci(42)</button>
  <button :class="{ active: tab === 'sqlite' }" @click="tab = 'sqlite'">SQLite</button>
</div>

<div v-if="tab === 'startup'" :key="'s'+Date.now()" class="bench-panel">
  <p class="bench-desc">Time to print &quot;Hello, World!&quot; and exit. Average of 50 runs. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">3.5ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 59%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>5.9ms</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 20%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">17.6ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 7%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">52.7ms</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 5%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">94.6ms</div>
    </div>
  </div>
  <p class="bench-note">ChadScript and Go are precompiled native binaries — no runtime to bootstrap. Bun/Node must initialize their JS engines. Python loads its interpreter.</p>
  <p class="bench-details"><a href="https://github.com/cssmith36/ChadScript/tree/main/benchmarks" target="_blank">details &rarr;</a></p>
</div>

<div v-if="tab === 'fib'" :key="'f'+Date.now()" class="bench-panel">
  <p class="bench-desc">Recursive <code>fib(42)</code>, no memoization. Pure function-call + arithmetic overhead. <em>Lower is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">Go</div>
      <div class="bench-track">
        <div class="bench-bar go" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">1.93s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 91%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>2.11s</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 72%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">2.69s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 44%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">4.41s</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 5%; --d: 0.48s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">61.3s</div>
    </div>
  </div>
  <p class="bench-note">ChadScript compiles to LLVM IR with the same optimizations as clang/C++. Go's edge comes from native <code>int64</code> — ChadScript uses <code>double</code> for all numbers.</p>
  <p class="bench-details"><a href="https://github.com/cssmith36/ChadScript/tree/main/benchmarks" target="_blank">details &rarr;</a></p>
</div>

<div v-if="tab === 'sqlite'" :key="'q'+Date.now()" class="bench-panel">
  <p class="bench-desc">100K <code>SELECT</code> queries on a 100-row in-memory table. <em>Higher is better.</em></p>
  <div class="bench-chart">
    <div class="bench-row">
      <div class="bench-label">Python</div>
      <div class="bench-track">
        <div class="bench-bar python" style="--w: 100%; --d: 0.0s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">348K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label chad-label">ChadScript</div>
      <div class="bench-track">
        <div class="bench-bar chad" style="--w: 92%; --d: 0.12s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val"><strong>322K qps</strong></div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Bun</div>
      <div class="bench-track">
        <div class="bench-bar bun" style="--w: 49%; --d: 0.24s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">171K qps</div>
    </div>
    <div class="bench-row">
      <div class="bench-label">Node.js</div>
      <div class="bench-track">
        <div class="bench-bar node" style="--w: 41%; --d: 0.36s"><div class="bench-ball"></div></div>
      </div>
      <div class="bench-val">141K qps</div>
    </div>
  </div>
  <p class="bench-note">ChadScript calls SQLite's C API directly — no FFI bridge, no marshaling. Python's <code>sqlite3</code> module is decades-old battle-tested C. Both ~2x the JS runtimes.</p>
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
@keyframes bench-race {
  0% { width: 0; }
  85% { width: calc(var(--w) + 1.5%); }
  100% { width: var(--w); }
}
.bench-bar.chad { background: #e8a525; }
.bench-bar.go { background: rgba(255,255,255,0.25); }
.bench-bar.bun { background: rgba(255,255,255,0.25); }
.bench-bar.node { background: rgba(255,255,255,0.25); }
.bench-bar.python { background: rgba(255,255,255,0.25); }
</style>
