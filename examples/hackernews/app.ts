// Hacker News Clone - full-stack app with SQLite, embedded files, and server-side rendering
import { ArgumentParser } from "../../src/argparse.js";

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

sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Show HN: ChadScript - TypeScript to native compiler via LLVM', 'https://github.com/cs01/ChadScript', 342)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Why we moved from Node.js to native binaries', 'https://example.com/native', 287)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('LLVM IR is surprisingly readable', 'https://llvm.org/docs/LangRef.html', 256)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('SQLite is the only database you need', 'https://sqlite.org', 234)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Single-binary deployments changed everything', 'https://example.com/single-binary', 198)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('The Boehm GC: garbage collection for C programs', 'https://hboehm.info/gc/', 176)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Zero-cost TypeScript: no runtime overhead', 'https://example.com/zero-cost', 165)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('libwebsockets: lightweight C WebSocket library', 'https://libwebsockets.org', 154)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Self-hosting compilers: the ultimate test', 'https://example.com/self-hosting', 143)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Compile-time file embedding in native languages', 'https://example.com/embed', 132)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Why I stopped using Docker for simple services', 'https://example.com/no-docker', 121)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('libuv: the event loop behind Node.js', 'https://libuv.org', 110)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Tree-sitter for building parsers', 'https://tree-sitter.github.io', 98)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Ask HN: What is your deploy strategy for side projects?', 'https://news.ycombinator.com', 87)",
);
sqlite.exec(
  db,
  "INSERT INTO posts (title, url, points) VALUES ('Building a compiler is easier than you think', 'https://example.com/compiler-easy', 76)",
);

function renderPosts(): string {
  const posts: Post[] = sqlite.query(
    db,
    "SELECT id, title, url, points FROM posts ORDER BY points DESC",
  );
  let html = "";
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const rank = i + 1;
    html = html + '<div class="post"><span class="rank">' + rank + ".</span>";
    html = html + '<form method="POST" action="upvote/' + post.id + '" style="display:inline">';
    html = html + '<button type="submit" class="upvote" title="upvote"></button></form>';
    html =
      html + '<span class="title"><a href="' + post.url + '">' + post.title + "</a></span></div>";
    html = html + '<div class="meta">' + post.points + " points</div>";
  }
  return html;
}

function handleRequest(req: HttpRequest): HttpResponse {
  console.log(req.method + " " + req.path);

  if (req.method === "GET" && req.path === "/") {
    const template = ChadScript.getEmbeddedFile("index.html");
    const posts = renderPosts();
    const body = template.replace("{{POSTS}}", posts);
    return { status: 200, body: body };
  }

  if (req.method === "POST" && req.path.startsWith("/upvote/")) {
    const idStr = req.path.substring(8, req.path.length);
    sqlite.exec(db, "UPDATE posts SET points = points + 1 WHERE id = ?", [idStr]);
    const redirectHtml =
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=../"></head><body>Redirecting...</body></html>';
    return { status: 200, body: redirectHtml };
  }

  // Serve all other embedded files (CSS, images, etc.) with a single line
  return ChadScript.serveEmbedded(req.path);
}

console.log("Hacker News Clone");
console.log("  listening on http://localhost:" + port);
console.log("  HTML/CSS embedded in the binary at compile time");
console.log("  SQLite database running in-memory with 15 posts");
console.log("");
console.log("Open http://localhost:" + port + " in your browser");
console.log("");
httpServe(port, handleRequest);
