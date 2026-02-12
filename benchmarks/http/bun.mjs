Bun.serve({
  port: 9876,
  fetch(req) {
    return new Response("Hello, World!");
  },
});

console.log("Bun listening on 9876");
