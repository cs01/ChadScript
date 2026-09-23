// @category: parsing
// A tiny XML parser (elements, attributes, text, self-closing tags, comments, entities) into a
// tree, a pretty printer, and simple queries by tag name and attribute.

interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decode(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

function parseXml(src: string): XmlElement {
  let pos = 0;
  const root: XmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  while (pos < src.length) {
    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos);
      pos = end < 0 ? src.length : end + 3;
    } else if (src.startsWith("<?", pos)) {
      const end = src.indexOf("?>", pos);
      pos = end < 0 ? src.length : end + 2;
    } else if (src.startsWith("</", pos)) {
      const end = src.indexOf(">", pos);
      const tag = src.slice(pos + 2, end).trim();
      const open = stack.pop();
      if (!open || open.tag !== tag) throw new Error(`mismatched </${tag}> (open: ${open?.tag})`);
      pos = end + 1;
    } else if (src[pos] === "<") {
      const end = src.indexOf(">", pos);
      let inner = src.slice(pos + 1, end);
      const selfClosing = inner.endsWith("/");
      if (selfClosing) inner = inner.slice(0, -1);
      const tag = inner.split(/\s/)[0] ?? "";
      const attrs: Record<string, string> = {};
      for (const m of inner.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]!] = decode(m[2]!);
      const el: XmlElement = { tag, attrs, children: [] };
      stack[stack.length - 1]!.children.push(el);
      if (!selfClosing) stack.push(el);
      pos = end + 1;
    } else {
      const next = src.indexOf("<", pos);
      const text = src.slice(pos, next < 0 ? src.length : next);
      if (text.trim()) stack[stack.length - 1]!.children.push(decode(text.trim()));
      pos = next < 0 ? src.length : next;
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  return root;
}

function pretty(node: XmlNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (typeof node === "string") return pad + node;
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  if (node.children.length === 0) return `${pad}<${node.tag}${attrs}/>`;
  if (node.children.length === 1 && typeof node.children[0] === "string") {
    return `${pad}<${node.tag}${attrs}>${node.children[0]}</${node.tag}>`;
  }
  return [
    `${pad}<${node.tag}${attrs}>`,
    ...node.children.map((c) => pretty(c, depth + 1)),
    `${pad}</${node.tag}>`,
  ].join("\n");
}

function findAll(node: XmlElement, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of node.children) {
    if (typeof c === "string") continue;
    if (c.tag === tag) out.push(c);
    out.push(...findAll(c, tag));
  }
  return out;
}

const text = (el: XmlElement): string =>
  el.children.map((c) => (typeof c === "string" ? c : text(c))).join("");

const doc = parseXml(`<?xml version="1.0"?>
<library name="City &amp; County">
  <!-- fiction section -->
  <book id="b1" lang="en"><title>Dune</title><year>1965</year><tag>sf</tag><tag>classic</tag></book>
  <book id="b2" lang="fr"><title>L&apos;Étranger</title><year>1942</year></book>
  <book id="b3" lang="en"><title>Snow Crash</title><year>1992</year><tag>sf</tag></book>
  <shelf empty="true"/>
</library>`);

const library = doc.children.find(
  (c): c is XmlElement => typeof c !== "string" && c.tag === "library",
)!;
console.log(pretty(library));
console.log(`library name: ${library.attrs["name"]}`);
const books = findAll(library, "book");
for (const b of books) {
  const title = text(findAll(b, "title")[0]!);
  const tags = findAll(b, "tag").map(text);
  console.log(
    `${b.attrs["id"]} [${b.attrs["lang"]}] ${title} (${text(findAll(b, "year")[0]!)}) ${tags.join(",")}`,
  );
}
console.log(
  "english sf:",
  books.filter((b) => b.attrs["lang"] === "en" && findAll(b, "tag").some((t) => text(t) === "sf"))
    .length,
);
for (const bad of ["<a><b></a>", "<a>"]) {
  try {
    parseXml(bad);
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
  }
}
