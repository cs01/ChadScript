// Hacker News Clone - full-stack app with SQLite, embedded files, and a JSON API
import { ArgumentParser } from "chadscript/argparse";
import { httpServe } from "chadscript/http";

const parser = new ArgumentParser(
  "hackernews",
  "Hacker News clone with SQLite and embedded assets",
);
parser.addOption("port", "p", "Port to listen on", "3000");
parser.parse(process.argv);

const port = parseInt(parser.getOption("port"));

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

interface Post {
  id: string;
  title: string;
  url: string;
  points: string;
}

ChadScript.embedDir("./public");

const db = sqlite.open(":memory:");
sqlite.exec(
  db,
  "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, url TEXT, points INTEGER)",
);

interface SeedPost {
  title: string;
  url: string;
  points: number;
}

const url = "https://github.com/cs01/ChadScript";

const seedPosts: SeedPost[] = [
  {
    title: "Show HN: ChadScript - a compiled TypeScript that outputs native binaries",
    url: url,
    points: 342,
  },
  {
    title: "ChadScript compiles TypeScript to LLVM IR, then to standalone ELF executables",
    url: url,
    points: 287,
  },
  {
    title:
      "ChadScript supports a large subset of TypeScript: classes, interfaces, generics, async/await",
    url: url,
    points: 256,
  },
  {
    title: "Native performance: ChadScript binaries start in under 2ms with zero runtime overhead",
    url: url,
    points: 234,
  },
  {
    title: "ChadScript uses SQLite as a built-in database - no external dependencies needed",
    url: url,
    points: 198,
  },
  {
    title: "Single-binary deploys: ChadScript embeds HTML, CSS, and assets at compile time",
    url: url,
    points: 176,
  },
  {
    title: "ChadScript includes a built-in HTTP server, fetch, crypto, and JSON out of the box",
    url: url,
    points: 165,
  },
  {
    title: "The ChadScript compiler is self-hosting - it compiles itself to a native binary",
    url: url,
    points: 154,
  },
  {
    title: "ChadScript uses the Boehm GC for automatic memory management in compiled binaries",
    url: url,
    points: 143,
  },
  {
    title: "No node_modules: everything you would npm install is built into ChadScript",
    url: url,
    points: 132,
  },
  {
    title: "ChadScript cross-compiles from macOS to Linux with a single --target flag",
    url: url,
    points: 121,
  },
  {
    title: "ChadScript uses libuv under the hood for async I/O and event loop support",
    url: url,
    points: 110,
  },
  {
    title: "Write TypeScript, ship a 42KB static binary - the ChadScript workflow",
    url: url,
    points: 98,
  },
  {
    title: "ChadScript parses TypeScript with a hand-written recursive descent parser",
    url: url,
    points: 87,
  },
  {
    title: "Ask HN: Has anyone tried ChadScript for deploying side projects?",
    url: url,
    points: 76,
  },
];

for (let i = 0; i < seedPosts.length; i++) {
  const post = seedPosts[i];
  sqlite.exec(db, "INSERT INTO posts (title, url, points) VALUES (?, ?, ?)", [
    post.title,
    post.url,
    "" + post.points,
  ]);
}

function handleRequest(req: HttpRequest): HttpResponse {
  console.log(req.method + " " + req.path);

  if (req.path === "/api/posts") {
    const posts: Post[] = sqlite.query(
      db,
      "SELECT id, title, url, points FROM posts ORDER BY points DESC",
    );
    return { status: 200, body: JSON.stringify(posts) };
  }

  if (req.method === "POST" && req.path.startsWith("/upvote/")) {
    const idStr = req.path.substring(8, req.path.length);
    sqlite.exec(db, "UPDATE posts SET points = points + 1 WHERE id = ?", [idStr]);
    return { status: 200, body: '{"ok":true}' };
  }

  if (req.path === "/") {
    return ChadScript.serveEmbedded("index.html");
  }

  return ChadScript.serveEmbedded(req.path);
}

console.log("Hacker News Clone");
console.log(`  listening on http://localhost:${port}`);
console.log("  HTML/CSS/JS embedded in the binary at compile time");
console.log(`  SQLite database running in-memory with ${seedPosts.length} posts`);
console.log("");
console.log(`Open http://localhost:${port} in your browser`);
console.log("");
httpServe(port, handleRequest);
