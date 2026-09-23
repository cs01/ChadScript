// Which util.format directive consumes each console.log argument. Shared by the validator (which
// rejects an argument a directive cannot render exactly) and codegen (which emits the conversions a
// call site can need, src/codegen/console-format.ts). The loop mirrors runtime/format.milo, itself
// Node's formatWithOptionsInternal.

// A directive letter, or "append" for an argument printed after the format string.
export type Directive = "append" | "s" | "d" | "i" | "f" | "j" | "o" | "O" | "c";

export const ALL_DIRECTIVES: readonly Directive[] = ["append", "s", "d", "i", "f", "j", "o", "O"];

const LETTERS = new Set(["s", "d", "i", "f", "j", "o", "O", "c"]);

// For a literal format string and `nargs` arguments (the format string included, as index 0):
// the directive each later argument meets. Index 0 is "append" when nothing is substituted.
export function literalDirectives(fmt: string, nargs: number): Directive[] {
  const out: Directive[] = new Array<Directive>(nargs).fill("append");
  let a = 0;
  let lastPos = 0;
  for (let i = 0; i < fmt.length - 1; i++) {
    if (fmt[i] !== "%") continue;
    const c = fmt[++i]!;
    if (a + 1 !== nargs) {
      if (LETTERS.has(c)) {
        out[++a] = c as Directive;
        lastPos = i + 1;
      } else if (c === "%") {
        lastPos = i + 1;
      }
    } else if (c === "%") {
      lastPos = i + 1;
    }
  }
  return out;
}

// Whether a literal first argument can make the substitution pass do anything at all.
export function literalMayFormat(fmt: string): boolean {
  return fmt.includes("%");
}
