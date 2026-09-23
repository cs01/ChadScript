export { SQUARE_METERS } from "./constants";

export function format(value: number, unit: string): string {
  return `${Math.round(value * 1000) / 1000} ${unit}`;
}
