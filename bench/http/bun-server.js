const port = parseInt(process.env.PORT || "3000", 10);

export default {
  port,
  fetch(req) {
    return new Response("Hello, World!");
  },
};
