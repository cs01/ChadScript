// @category: parsing
// A hand-written URL parser (scheme, userinfo, host, port, path, query, fragment), query-string
// decoding into a multimap, and URL building with percent-encoding.

interface ParsedUrl {
  scheme: string;
  user: string | null;
  host: string;
  port: number | null;
  path: string;
  query: Map<string, string[]>;
  fragment: string | null;
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443, ftp: 21 };

function parseQuery(q: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!q) return out;
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawVal = eq < 0 ? "" : pair.slice(eq + 1);
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const val = decodeURIComponent(rawVal.replace(/\+/g, " "));
    const list = out.get(key) ?? [];
    list.push(val);
    out.set(key, list);
  }
  return out;
}

function parseUrl(input: string): ParsedUrl {
  const m =
    /^([a-z][a-z0-9+.-]*):\/\/(?:([^@/]*)@)?([^:/?#]+)(?::(\d+))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
      input,
    );
  if (!m) throw new TypeError(`Invalid URL: ${input}`);
  const scheme = m[1]!.toLowerCase();
  const port = m[4] !== undefined ? Number(m[4]) : null;
  return {
    scheme,
    user: m[2] ?? null,
    host: m[3]!.toLowerCase(),
    port: port === DEFAULT_PORTS[scheme] ? null : port,
    path: m[5] || "/",
    query: parseQuery(m[6] ?? ""),
    fragment: m[7] ?? null,
  };
}

function buildUrl(u: ParsedUrl): string {
  let s = `${u.scheme}://`;
  if (u.user) s += `${u.user}@`;
  s += u.host;
  if (u.port !== null) s += `:${u.port}`;
  s += u.path;
  const pairs: string[] = [];
  for (const [k, vs] of u.query)
    for (const v of vs) pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (pairs.length) s += `?${pairs.join("&")}`;
  if (u.fragment !== null) s += `#${u.fragment}`;
  return s;
}

const inputs = [
  "https://Example.COM:443/search?q=type+script&lang=en&lang=fr#results",
  "http://user:pw@localhost:8080/api/v1/items?id=42&filter=a%26b",
  "ftp://files.example.org/pub/",
  "https://example.com",
  "not a url",
  "https://example.com/p?empty=&flag&x=%E2%9C%93",
];

for (const input of inputs) {
  try {
    const u = parseUrl(input);
    const query = [...u.query].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    console.log(
      `${u.scheme} | ${u.user ?? "-"} | ${u.host} | ${u.port ?? "default"} | ${u.path} | ${query || "-"} | ${u.fragment ?? "-"}`,
    );
    console.log(`  rebuilt: ${buildUrl(u)}`);
  } catch (e) {
    console.log(`${(e as Error).name}: ${(e as Error).message}`);
  }
}

console.log(encodeURIComponent("a b&c/d?e=f"), decodeURIComponent("%41%42%20c"));
