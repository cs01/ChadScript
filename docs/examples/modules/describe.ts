import type { Shape } from "./geometry";

export default function describe(s: Shape): string {
  return `${s.kind}(${s.size})`;
}
