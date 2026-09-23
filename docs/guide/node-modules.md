# node:fs and node:path

A small part of Node's standard library is built in, implemented in the runtime with Node's
semantics. Import it the usual way, in named, default or namespace form.

<<< @/examples/fs-path.ts

<<< @/examples/fs-path.out{text}

## What is available

The ambient declarations in
[`stdlib/globals.d.ts`](https://github.com/cs01/ChadScript/blob/main/stdlib/globals.d.ts) are the
whole surface; importing anything else fails to typecheck ([CS0001](/reference/errors#cs0001)).

| Module             | Functions                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `node:fs`          | `readFileSync(path, "utf8")`, `writeFileSync`, `appendFileSync`, `existsSync`, `unlinkSync` |
| `node:fs/promises` | `readFile(path, "utf8")`, `writeFile`, `appendFile`, `unlink`                               |
| `node:path`        | `join`, `resolve`, `normalize`, `dirname`, `basename`, `extname`, `isAbsolute`              |

A failing file operation (reading a missing file, say) throws, as in Node, so `try`/`catch` is
how you handle it; `existsSync` is the non-throwing check.

## process

The global `process` provides `process.argv.slice(2)` (the arguments after the program),
`process.exit(code)` and `process.pid`. Only the exact expression `process.argv.slice(2)` is
accepted ([CS1229](/reference/errors#cs1229)): Node's `argv[0]` and `argv[1]` are the node
binary and the script path, which a compiled binary does not have. With that slice, the same
arguments mean the same thing to both.

<<< @/examples/argv.ts

```sh
$ bin/chad build argv.ts -o greet && ./greet ada lin
```

<<< @/examples/argv.out{text}

Planned: more of `fs` (directories, stat), `node:process` as an importable module, and
environment variables.

Next: [console.log](/guide/console).
