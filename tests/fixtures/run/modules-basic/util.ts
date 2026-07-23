// A module that itself imports: the initialization order must be shapes -> util -> main.
import { ORIGIN } from "./shapes.ts";

export const SCALE = ORIGIN + 2;

export function scaled(n: number): number {
  return n * SCALE;
}
