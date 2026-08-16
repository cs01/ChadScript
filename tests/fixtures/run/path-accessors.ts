import { dirname, basename, extname, isAbsolute } from "node:path";

const paths = [
  "/a/b/c.txt",
  "a/b/c.txt",
  "c.txt",
  "/a/b/",
  "/a/b//",
  "/",
  "//",
  "//a",
  "",
  ".",
  "..",
  ".bashrc",
  "a.",
  "a..",
  "..a",
  "/a/.b",
  "index.d.ts",
  "a/b.c/d",
  "file.tar.gz",
];

for (const p of paths) {
  console.log(
    `[${p}] dir=${dirname(p)} base=${basename(p)} ext=${extname(p)} abs=${isAbsolute(p)}`,
  );
}
