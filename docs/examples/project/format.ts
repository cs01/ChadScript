export default function formatRow(label: string, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${label.padEnd(8)}${rounded}`;
}
