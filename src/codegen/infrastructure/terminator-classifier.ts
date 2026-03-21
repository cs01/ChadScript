export function classifyTerminator(instruction: string): number {
  const trimmed = instruction.trim();
  if (
    trimmed.startsWith("ret ") ||
    trimmed === "ret void" ||
    trimmed.startsWith("br ") ||
    trimmed.startsWith("unreachable") ||
    trimmed.startsWith("switch ")
  )
    return 1;
  return 0;
}
