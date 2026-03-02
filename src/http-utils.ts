export function getHeader(headersRaw: string, name: string): string {
  const lower = name.toLowerCase();
  const lines = headersRaw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.substring(0, colon).toLowerCase().trim();
    if (key === lower) {
      return line.substring(colon + 1).trim();
    }
  }
  return "";
}

export function parseQueryString(qs: string): Map<string, string> {
  const result = new Map<string, string>();
  if (qs.length === 0) return result;
  const pairs = qs.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const eq = pair.indexOf("=");
    if (eq < 0) {
      result.set(pair, "");
    } else {
      result.set(pair.substring(0, eq), pair.substring(eq + 1));
    }
  }
  return result;
}

export function parseCookies(cookieHeader: string): Map<string, string> {
  const result = new Map<string, string>();
  if (cookieHeader.length === 0) return result;
  const parts = cookieHeader.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf("=");
    if (eq < 0) {
      result.set(part, "");
    } else {
      result.set(part.substring(0, eq).trim(), part.substring(eq + 1).trim());
    }
  }
  return result;
}
