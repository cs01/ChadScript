export function classifyTerminator(instruction: string): boolean {
  const trimmed = instruction.trim();
  return (
    trimmed.startsWith("ret ") ||
    trimmed === "ret void" ||
    trimmed.startsWith("br ") ||
    trimmed.startsWith("unreachable") ||
    trimmed.startsWith("switch ")
  );
}
