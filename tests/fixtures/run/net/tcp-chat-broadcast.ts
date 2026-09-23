// A chat server: sockets kept in an array and a Map, a message from one client broadcast to every
// other client (compared by identity), and a client leaving removed from both. The clients join
// one after another and each waits for its own welcome line, so the transcript is ordered.
import * as net from "node:net";

let members: net.Socket[] = [];
const names = new Map<string, net.Socket>();

const server = net.createServer((socket) => {
  const name = "user" + (members.length + 1);
  members.push(socket);
  names.set(name, socket);
  socket.write("welcome " + name + "\n");
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    const text = chunk.toString().trim();
    for (const other of members) {
      if (other !== socket) other.write(name + ": " + text + "\n");
    }
  });
  socket.on("close", () => {
    members = members.filter((m) => m !== socket);
    names.delete(name);
    if (members.length === 0)
      server.close(() => console.log("server closed, members left:", names.size));
  });
});

function join(port: number, onWelcome: (c: net.Socket, log: string[]) => void): void {
  const log: string[] = [];
  let buffered = "";
  const c = net.connect({ port: port, host: "127.0.0.1" });
  c.on("data", (chunk) => {
    buffered += chunk.toString();
    let nl = buffered.indexOf("\n");
    while (nl >= 0) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      log.push(line);
      if (log.length === 1) onWelcome(c, log);
      nl = buffered.indexOf("\n");
    }
  });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  join(port, (alice, aliceLog) => {
    console.log("alice got:", aliceLog[0]);
    join(port, (bob, bobLog) => {
      console.log("bob got:", bobLog[0]);
      bob.write("hello alice\n");
      const waitForAlice = (): void => {
        if (aliceLog.length < 2) {
          setTimeout(waitForAlice, 5);
          return;
        }
        console.log("alice then got:", aliceLog[1]);
        console.log("bob's log has", bobLog.length, "line");
        alice.end();
        bob.end();
      };
      waitForAlice();
    });
  });
});
