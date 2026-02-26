<template>
  <div class="comparison-section">
    <h2 class="comparison-heading">Why ChadScript?</h2>
    <div class="comparison-grid">
      <div class="comparison-card card-runtime">
        <div class="card-header">
          <span class="card-badge badge-runtime">vs</span>
          <span class="card-title">Node.js / Deno / Bun</span>
        </div>
        <p class="card-body">No runtime, no <code>node_modules</code>, no cold start penalty. Ship a single binary.</p>
      </div>
      <div class="comparison-card card-systems">
        <div class="card-header">
          <span class="card-badge badge-systems">vs</span>
          <span class="card-title">Rust / C / C++</span>
        </div>
        <p class="card-body">You already know the syntax. No borrow checker, no header files, no makefiles.</p>
      </div>
      <div class="comparison-card card-go">
        <div class="card-header">
          <span class="card-badge badge-go">vs</span>
          <span class="card-title">Go</span>
        </div>
        <p class="card-body">TypeScript syntax instead of Go's idiosyncratic type system. Classes, interfaces, closures, and async/await work the way you expect.</p>
      </div>
    </div>
    <div class="comparison-callout">
      <strong>ChadScript is not a drop-in replacement for TypeScript</strong> — it's a compiled language that uses TypeScript syntax.
    </div>
  </div>
</template>

<style scoped>
.comparison-section {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
}

.comparison-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  border: none;
  color: var(--vp-c-text-1);
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 768px) {
  .comparison-grid {
    grid-template-columns: 1fr;
  }
}

.comparison-card {
  border-radius: 12px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.comparison-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.card-runtime {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.02) 100%);
  border-top: 3px solid #22c55e;
}

.card-systems {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%);
  border-top: 3px solid #3b82f6;
}

.card-go {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.08) 0%, rgba(168, 85, 247, 0.02) 100%);
  border-top: 3px solid #a855f7;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.card-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.badge-runtime {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.badge-systems {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.badge-go {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}

.card-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.card-body {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}

.card-body code {
  font-size: 0.82rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--vp-c-text-1);
}

.comparison-callout {
  margin-top: 1.5rem;
  padding: 16px 20px;
  border-radius: 8px;
  border-left: 4px solid var(--vp-c-brand-1);
  background: rgba(245, 158, 11, 0.06);
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  text-align: center;
}
</style>
