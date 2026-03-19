const ESC = "\x1b[";
const RESET = "\x1b[0m";

function wrap(code: string, text: string): string {
  return ESC + code + "m" + text + RESET;
}

export function red(text: string): string {
  return wrap("31", text);
}

export function green(text: string): string {
  return wrap("32", text);
}

export function yellow(text: string): string {
  return wrap("33", text);
}

export function blue(text: string): string {
  return wrap("34", text);
}

export function magenta(text: string): string {
  return wrap("35", text);
}

export function cyan(text: string): string {
  return wrap("36", text);
}

export function white(text: string): string {
  return wrap("37", text);
}

export function gray(text: string): string {
  return wrap("90", text);
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function dim(text: string): string {
  return wrap("2", text);
}

export function italic(text: string): string {
  return wrap("3", text);
}

export function underline(text: string): string {
  return wrap("4", text);
}

export function strikethrough(text: string): string {
  return wrap("9", text);
}

export function bgRed(text: string): string {
  return wrap("41", text);
}

export function bgGreen(text: string): string {
  return wrap("42", text);
}

export function bgYellow(text: string): string {
  return wrap("43", text);
}

export function bgBlue(text: string): string {
  return wrap("44", text);
}

export function bgMagenta(text: string): string {
  return wrap("45", text);
}

export function bgCyan(text: string): string {
  return wrap("46", text);
}

export function bgWhite(text: string): string {
  return wrap("47", text);
}

export function stripAnsi(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) === "\x1b" && i + 1 < text.length && text.charAt(i + 1) === "[") {
      i = i + 2;
      while (i < text.length && text.charAt(i) !== "m") {
        i = i + 1;
      }
      i = i + 1;
    } else {
      result = result + text.charAt(i);
      i = i + 1;
    }
  }
  return result;
}
