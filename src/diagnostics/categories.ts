export const CAT_TYPE_TRACE = "type-trace";
export const CAT_TYPE_DIVERGENCE = "type-divergence";
export const CAT_RESOLVER_PURITY = "resolver-purity";

export const KNOWN_CATEGORIES: string[] = [
  CAT_TYPE_TRACE,
  CAT_TYPE_DIVERGENCE,
  CAT_RESOLVER_PURITY,
];

export function parseCategories(csv: string): string[] {
  const result: string[] = [];
  if (!csv) return result;
  const parts = csv.split(",");
  for (const raw of parts) {
    const name = raw.trim();
    if (!name) continue;
    let known = false;
    for (const k of KNOWN_CATEGORIES) {
      if (k === name) {
        known = true;
        break;
      }
    }
    if (!known) {
      console.error("warning: unknown diagnostic category " + name);
      continue;
    }
    result.push(name);
  }
  return result;
}
