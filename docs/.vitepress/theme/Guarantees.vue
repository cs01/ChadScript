<!-- The three guarantees from the charter (PLAN.md "Constitution"), as cards. -->
<template>
  <div class="g-section">
    <h2 class="g-heading">Three guarantees</h2>
    <div class="g-grid">
      <div class="g-card g-types">
        <div class="g-header">
          <span class="g-badge">1</span>
          <span class="g-title">tsc is the type oracle</span>
        </div>
        <p class="g-body">
          Programs must typecheck with zero errors under <code>strict</code>,
          <code>noUncheckedIndexedAccess</code> and <code>exactOptionalPropertyTypes</code>. The
          compiler never infers a type of its own; every value's representation comes from tsc's
          answer.
        </p>
      </div>
      <div class="g-card g-node">
        <div class="g-header">
          <span class="g-badge">2</span>
          <span class="g-title">Node is the semantics oracle</span>
        </div>
        <p class="g-body">
          Every test program runs under Node and as a native binary at <code>-O0</code> and
          <code>-O2</code>; stdout and exit code must match byte for byte, and the IR must pass
          <code>opt -passes=verify</code>. Seeded fuzzers generate more programs the same way.
        </p>
      </div>
      <div class="g-card g-deny">
        <div class="g-header">
          <span class="g-badge">3</span>
          <span class="g-title">The validator is default-deny</span>
        </div>
        <p class="g-body">
          A construct is compiled only if an allowlist rule admits it, and every rule has a
          differential test. Everything else is rejected with a <code>CS####</code> code, a span and
          a rewrite hint. "Compiles but behaves differently" is treated as a P0 bug.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.g-section {
  max-width: 960px;
  margin: 3rem auto 0;
  padding: 0 24px;
}
.g-heading {
  text-align: center;
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  border: none;
  color: var(--vp-c-text-1);
}
.g-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 768px) {
  .g-grid {
    grid-template-columns: 1fr;
  }
}
.g-card {
  border-radius: 12px;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
}
.g-types {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%);
  border-top: 3px solid #3b82f6;
}
.g-node {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.02) 100%);
  border-top: 3px solid #22c55e;
}
.g-deny {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%);
  border-top: 3px solid #f59e0b;
}
.g-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.g-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 800;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
  flex-shrink: 0;
}
.g-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.g-body {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}
.g-body code {
  font-size: 0.8rem;
}
</style>
