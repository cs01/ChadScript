<!-- Horizontal bars for the generated benchmark results (docs/generated/benchmarks.json, written
     by docs/scripts/bench-page.ts). Imported at build time, so the page has no runtime fetch. -->
<script setup lang="ts">
import data from "../../generated/benchmarks.json";

interface Timing {
  label: string;
  ms: number;
}

const NAMES: Record<string, string> = { chad: "ChadScript", node: "Node", rust: "Rust" };

const rows = data.results
  .filter((r) => r.timings !== null)
  .map((r) => {
    const timings = r.timings as Timing[];
    const max = Math.max(...timings.map((t) => t.ms));
    return {
      name: r.name,
      bars: timings.map((t) => ({
        who: NAMES[t.label] ?? t.label,
        hero: t.label === "chad",
        pct: Math.max(2, Math.round((t.ms / max) * 100)),
        text: t.ms >= 1000 ? `${(t.ms / 1000).toFixed(2)} s` : `${Math.round(t.ms)} ms`,
      })),
    };
  });
</script>

<template>
  <div class="bb">
    <div v-for="r in rows" :key="r.name" class="bb-group">
      <div class="bb-name">{{ r.name }}</div>
      <div v-for="b in r.bars" :key="b.who" class="bb-row">
        <span class="bb-who" :class="{ hero: b.hero }">{{ b.who }}</span>
        <span class="bb-track">
          <span class="bb-fill" :class="{ hero: b.hero }" :style="{ width: b.pct + '%' }"></span>
        </span>
        <span class="bb-val">{{ b.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bb {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px 28px;
  margin: 1.5rem 0;
}
.bb-name {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  font-size: 0.9rem;
  margin-bottom: 6px;
}
.bb-row {
  display: grid;
  grid-template-columns: 84px 1fr 64px;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  margin: 3px 0;
}
.bb-who {
  color: var(--vp-c-text-2);
}
.bb-who.hero {
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.bb-track {
  height: 10px;
  border-radius: 5px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.bb-fill {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: var(--vp-c-text-3);
}
.bb-fill.hero {
  background: var(--vp-c-brand-1);
}
.bb-val {
  font-family: var(--vp-font-family-mono);
  text-align: right;
  color: var(--vp-c-text-2);
}
</style>
