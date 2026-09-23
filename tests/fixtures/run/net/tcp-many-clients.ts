// Many clients at once: each one connects, sends its id, and reads back the server's answer. The
// answers arrive in whatever order the connections finish, so they are collected and printed
// sorted once the last client has closed, which keeps the transcript independent of scheduling.
import * as net from "node:net";

const CLIENTS = 20;
let served = 0;
const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let request = "";
  socket.on("data", (chunk) => {
    request += chunk.toString();
    if (request.endsWith("\n")) {
      served++;
      socket.end("square of " + request.trim() + " is " + Number(request) * Number(request));
    }
  });
});

const answers: string[] = [];
let closed = 0;
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  for (let i = 1; i <= CLIENTS; i++) {
    const client = net.connect({ port: port, host: "127.0.0.1" }, () => {
      client.write(String(i) + "\n");
    });
    let answer = "";
    client.on("data", (chunk) => {
      answer += chunk.toString();
    });
    client.on("close", () => {
      answers.push(answer);
      closed++;
      if (closed === CLIENTS) {
        answers.sort();
        for (const a of answers) console.log(a);
        console.log("served", served, "clients");
        server.close();
      }
    });
  }
});
