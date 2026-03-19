export function match(pattern: string, path: string): boolean {
  return matchAt(pattern, 0, path, 0);
}

function matchAt(pattern: string, pi: number, path: string, si: number): boolean {
  while (pi < pattern.length) {
    const pc = pattern.charAt(pi);

    if (pc === "*" && pi + 1 < pattern.length && pattern.charAt(pi + 1) === "*") {
      let nextPi = pi + 2;
      if (nextPi < pattern.length && pattern.charAt(nextPi) === "/") {
        nextPi = nextPi + 1;
      }
      for (let i = si; i <= path.length; i++) {
        if (matchAt(pattern, nextPi, path, i)) return true;
      }
      return false;
    }

    if (pc === "*") {
      for (let i = si; i <= path.length; i++) {
        if (i > si && path.charAt(i - 1) === "/") break;
        if (matchAt(pattern, pi + 1, path, i)) return true;
      }
      return false;
    }

    if (pc === "?") {
      if (si >= path.length || path.charAt(si) === "/") return false;
      pi = pi + 1;
      si = si + 1;
      continue;
    }

    if (si >= path.length) return false;
    if (pc !== path.charAt(si)) return false;
    pi = pi + 1;
    si = si + 1;
  }
  return si === path.length;
}
