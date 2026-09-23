export const PREFIX = "hi";
export const suffix = "!";

export default function (name: string): string {
  return `${PREFIX} ${name}${suffix}`;
}
