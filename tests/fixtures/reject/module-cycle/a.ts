import { bump } from "./b.ts";

export const A: number = 1;

export function useB(): number {
  return bump(A);
}
