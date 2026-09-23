// A payload far larger than one read or one kernel send buffer: the writer's queue fills (write()
// returns false past Node's 16 KiB high-water mark), drains as the peer reads, and every byte
// arrives in order. Only lengths and a checksum are printed, never chunk boundaries.
import * as net from "node:net";

let payload = "";
for (let i = 0; i < 20000; i++) payload += String(i % 10) + "abcdefghijklmnopqrstuvwxyz\n";

function checksum(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i += 97) sum = (sum * 31 + s.length - i) % 1000003;
  return sum;
}

const server = net.createServer((socket) => {
  let got = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    got += chunk.toString();
  });
  socket.on("end", () => {
    console.log("server received", got.length, "bytes, intact:", got === payload);
    socket.end(String(checksum(got)));
  });
});

server.listen(0, "127.0.0.1", () => {
  const client = net.connect({ port: server.address().port, host: "127.0.0.1" });
  console.log("small write accepted:", client.write("0"));
  console.log("large write accepted:", client.write(payload.slice(1)));
  client.end();
  let reply = "";
  client.on("data", (chunk) => {
    reply += chunk.toString();
  });
  client.on("close", () => {
    console.log("checksum matches:", reply === String(checksum(payload)));
    server.close();
  });
});
