// A line-oriented request/response protocol over one connection: the client sends a command,
// waits for its reply line, then sends the next. Replies are split on newlines by the receiver,
// so the transcript does not depend on how TCP happens to chunk the bytes.
import * as net from "node:net";

const store = new Map<string, string>();

function handle(line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0] ?? "";
  if (cmd === "SET" && parts.length === 3) {
    store.set(parts[1] ?? "", parts[2] ?? "");
    return "OK";
  }
  if (cmd === "GET" && parts.length === 2) {
    const v = store.get(parts[1] ?? "");
    return v === undefined ? "NOT_FOUND" : "VALUE " + v;
  }
  if (cmd === "COUNT") return "COUNT " + store.size;
  return "ERROR unknown command: " + line;
}

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk.toString();
    let nl = pending.indexOf("\n");
    while (nl >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      socket.write(handle(line) + "\n");
      nl = pending.indexOf("\n");
    }
  });
});

const commands = ["SET a 1", "SET b two", "GET a", "GET b", "GET c", "COUNT", "FLY away"];

server.listen(0, "127.0.0.1", () => {
  const client = net.connect({ port: server.address().port, host: "127.0.0.1" });
  let next = 0;
  let buffered = "";
  const sendNext = (): void => {
    const cmd = commands[next];
    if (cmd === undefined) {
      client.end();
      return;
    }
    console.log(">", cmd);
    client.write(cmd + "\n");
  };
  client.on("connect", sendNext);
  client.on("data", (chunk) => {
    buffered += chunk.toString();
    let nl = buffered.indexOf("\n");
    while (nl >= 0) {
      console.log("<", buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
      next++;
      sendNext();
      nl = buffered.indexOf("\n");
    }
  });
  client.on("end", () => {
    console.log("client: server ended the connection");
  });
  client.on("close", () => {
    server.close(() => console.log("done"));
  });
});
