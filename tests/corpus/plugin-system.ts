// @category: oop
// A plugin architecture: a Plugin interface with optional hooks, an abstract base plugin with
// shared behavior, a registry that orders plugins by dependencies (topological sort) and runs a
// document through the hook pipeline.

interface Doc {
  title: string;
  body: string;
  meta: Map<string, string>;
}

interface Plugin {
  readonly name: string;
  readonly dependsOn: readonly string[];
  setup?(registry: Registry): void;
  transform?(doc: Doc): Doc;
  finish?(doc: Doc): void;
}

abstract class BasePlugin implements Plugin {
  abstract readonly name: string;
  readonly dependsOn: readonly string[] = [];
  protected calls = 0;

  transform(doc: Doc): Doc {
    this.calls++;
    return this.apply(doc);
  }

  protected abstract apply(doc: Doc): Doc;
}

class TrimPlugin extends BasePlugin {
  readonly name = "trim";
  protected apply(doc: Doc): Doc {
    return { ...doc, body: doc.body.trim() };
  }
}

class TitleCasePlugin extends BasePlugin {
  readonly name = "title-case";
  override readonly dependsOn = ["trim"];
  protected apply(doc: Doc): Doc {
    const title = doc.title
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return { ...doc, title };
  }
}

class WordCountPlugin extends BasePlugin {
  readonly name = "word-count";
  override readonly dependsOn = ["trim", "censor"];
  protected apply(doc: Doc): Doc {
    const meta = new Map(doc.meta);
    meta.set("words", String(doc.body.split(/\s+/).filter(Boolean).length));
    return { ...doc, meta };
  }
}

class CensorPlugin implements Plugin {
  readonly name = "censor";
  readonly dependsOn = ["trim"];
  private banned: string[] = [];
  setup(registry: Registry): void {
    this.banned = registry.option("banned")?.split(",") ?? [];
  }
  transform(doc: Doc): Doc {
    let body = doc.body;
    for (const word of this.banned) body = body.split(word).join("*".repeat(word.length));
    return { ...doc, body };
  }
}

class ReportPlugin implements Plugin {
  readonly name = "report";
  readonly dependsOn = ["word-count", "title-case"];
  finish(doc: Doc): void {
    console.log(`report: "${doc.title}" has ${doc.meta.get("words")} words`);
  }
}

class Registry {
  private plugins = new Map<string, Plugin>();
  constructor(private readonly options: Record<string, string>) {}

  option(key: string): string | undefined {
    return this.options[key];
  }

  register(...plugins: Plugin[]): this {
    for (const p of plugins) {
      if (this.plugins.has(p.name)) throw new Error(`duplicate plugin ${p.name}`);
      this.plugins.set(p.name, p);
    }
    return this;
  }

  order(): Plugin[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const out: Plugin[] = [];
    const visit = (name: string, chain: string[]): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`dependency cycle: ${[...chain, name].join(" -> ")}`);
      const p = this.plugins.get(name);
      if (!p) throw new Error(`missing dependency ${name} (needed by ${chain[chain.length - 1]})`);
      visiting.add(name);
      for (const dep of p.dependsOn) visit(dep, [...chain, name]);
      visiting.delete(name);
      visited.add(name);
      out.push(p);
    };
    for (const name of [...this.plugins.keys()].sort()) visit(name, []);
    return out;
  }

  run(doc: Doc): Doc {
    const ordered = this.order();
    console.log(`order: ${ordered.map((p) => p.name).join(" > ")}`);
    for (const p of ordered) p.setup?.(this);
    const result = ordered.reduce((d, p) => (p.transform ? p.transform(d) : d), doc);
    for (const p of ordered) p.finish?.(result);
    return result;
  }
}

const registry = new Registry({ banned: "darn,heck" }).register(
  new ReportPlugin(),
  new WordCountPlugin(),
  new CensorPlugin(),
  new TitleCasePlugin(),
  new TrimPlugin(),
);
const out = registry.run({
  title: "a tale of two plugins",
  body: "   well darn, what the heck is this?  ",
  meta: new Map(),
});
console.log(
  JSON.stringify({ title: out.title, body: out.body, meta: Object.fromEntries(out.meta) }),
);

for (const extra of [new ReportPlugin(), { name: "orphan", dependsOn: ["ghost"] }]) {
  try {
    new Registry({}).register(new TrimPlugin(), extra).order();
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
  }
}
