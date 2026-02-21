import http from "node:http";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = parseInt(process.env.PORT || "3000", 10);
const DURATION_SECS = parseInt(process.env.DURATION || "10", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "50", 10);

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY,
  maxFreeSockets: CONCURRENCY,
});

let totalRequests = 0;
let totalErrors = 0;
let running = true;
const intervalResults = [];

function makeRequest() {
  if (!running) return;

  const req = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: "/",
      method: "GET",
      agent,
    },
    (res) => {
      res.resume();
      res.on("end", () => {
        totalRequests++;
        if (running) makeRequest();
      });
    },
  );

  req.on("error", () => {
    totalErrors++;
    if (running) setTimeout(makeRequest, 1);
  });

  req.end();
}

console.log(
  `Benchmarking http://${HOST}:${PORT}/ for ${DURATION_SECS}s with ${CONCURRENCY} concurrent connections`,
);

for (let i = 0; i < CONCURRENCY; i++) {
  makeRequest();
}

const intervalId = setInterval(() => {
  const rps = totalRequests;
  intervalResults.push(rps);
  console.log(`  ${rps} req/s (errors: ${totalErrors})`);
  totalRequests = 0;
  totalErrors = 0;
}, 1000);

setTimeout(() => {
  running = false;
  clearInterval(intervalId);
  agent.destroy();

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
  console.log(`  avg: ${Math.round(avg)} req/s`);
  console.log(`  p50: ${p50} req/s`);
  console.log(`  p99: ${p99} req/s`);
  console.log(`  min: ${min} req/s`);
  console.log(`  max: ${max} req/s`);
  console.log(`  total samples: ${intervalResults.length} (first/last dropped)`);

  console.log(
    `\n${JSON.stringify({ avg: Math.round(avg), p50, p99, min, max, samples: intervalResults })}`,
  );
}, DURATION_SECS * 1000);
