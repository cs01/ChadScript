# Parse a JSON config file

Declare the shape as an interface, read the file with `node:fs`, and annotate the result of
`JSON.parse`. The annotation is the schema: ChadScript checks the parsed document against it.

## The program

::: code-group

<<< @/examples/config/main.ts

<<< @/examples/config/config.json

:::

The `@args` comment on the first line tells the docs test suite which arguments to pass; it is
an ordinary comment to the compiler.

## Build and run

```sh
bin/chad build main.ts -o config
./config docs/examples/config/config.json
```

<<< @/examples/config/main.out{text}

## When the file does not match

If `port` were the string `"8080"`, Node would hand back the wrong-shaped object and the program
would print `port 8080` by accident, or concatenate strings later. The compiled program throws at
`JSON.parse` instead, so a `Config` value always has `Config`'s fields. This is the one
deliberate difference from Node; [JSON](/guide/json) shows it side by side.

`loadOrExit` above catches that (and a missing file) where the file is loaded, prints the
reason and exits with status 1.

Next: [build a CLI tool](/howto/cli-tool).
