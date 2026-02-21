const WS_URL = process.env.WS_URL || "ws://127.0.0.1:3001";
const NUM_CLIENTS = parseInt(process.env.CLIENTS || "16", 10);
const DURATION_SECS = parseInt(process.env.DURATION || "10", 10);
const MSG_PAYLOAD = process.env.MSG || "Hello, World!";
const PIPELINE_DEPTH = 64;

const { WebSocket } = await import("ws");

let totalReceived = 0;
let running = true;
const intervalResults = [];
const clients = [];

console.log(`Connecting ${NUM_CLIENTS} WebSocket clients to ${WS_URL}...`);

const connectPromises = [];
for (let i = 0; i < NUM_CLIENTS; i++) {
  const ws = new WebSocket(WS_URL);
  clients.push(ws);
  connectPromises.push(
    new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    }),
  );
}

await Promise.all(connectPromises);
console.log(`All ${NUM_CLIENTS} clients connected`);

for (const ws of clients) {
  ws.onmessage = () => {
    totalReceived++;
    if (running) ws.send(MSG_PAYLOAD);
  };
}

for (const ws of clients) {
  for (let i = 0; i < PIPELINE_DEPTH; i++) {
    ws.send(MSG_PAYLOAD);
  }
}

const reportInterval = setInterval(() => {
  const count = totalReceived;
  intervalResults.push(count);
  console.log(`  ${count} msg/s`);
  totalReceived = 0;
}, 1000);

setTimeout(() => {
  running = false;
  clearInterval(reportInterval);

  for (const ws of clients) {
    ws.close();
  }

  if (intervalResults.length > 2) {
    intervalResults.shift();
    intervalResults.pop();
  }

  const avg = intervalResults.reduce((a, b) => a + b, 0) / intervalResults.length;
  const sorted = [...intervalResults].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  console.log("\n--- Results ---");
  console.log(`  avg: ${Math.round(avg)} msg/s`);
  console.log(`  p50: ${p50} msg/s`);
  console.log(`  p99: ${p99} msg/s`);
  console.log(`  min: ${min} msg/s`);
  console.log(`  max: ${max} msg/s`);
  console.log(`  total samples: ${intervalResults.length} (first/last dropped)`);

  console.log(
    `\n${JSON.stringify({ avg: Math.round(avg), p50, p99, min, max, samples: intervalResults })}`,
  );

  setTimeout(() => process.exit(0), 500);
}, DURATION_SECS * 1000);
