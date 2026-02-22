// @test expectTestPassed
let passed = true;

// os.platform should be "linux" or "darwin"
const plat = os.platform;
if (plat !== "linux" && plat !== "darwin") {
  console.log("FAIL: os.platform=" + plat);
  passed = false;
}

// os.arch should be a known architecture
const arch = os.arch;
if (arch !== "x64" && arch !== "arm64" && arch !== "x86") {
  console.log("FAIL: os.arch=" + arch);
  passed = false;
}

// os.EOL should be "\n"
if (os.EOL !== "\n") {
  console.log("FAIL: os.EOL wrong");
  passed = false;
}

// os.hostname() should return a non-empty string
const host = os.hostname();
if (host.length === 0) {
  console.log("FAIL: os.hostname() empty");
  passed = false;
}

// os.homedir() should return a path starting with /
const home = os.homedir();
if (home.length === 0) {
  console.log("FAIL: os.homedir() empty");
  passed = false;
}

// os.tmpdir() should return a non-empty path
const tmp = os.tmpdir();
if (tmp.length === 0) {
  console.log("FAIL: os.tmpdir() empty");
  passed = false;
}

// os.cpus() should be >= 1
const cpuCount = os.cpus();
if (cpuCount < 1) {
  console.log("FAIL: os.cpus()=" + cpuCount);
  passed = false;
}

// os.totalmem() should be > 0
const totalMem = os.totalmem();
if (totalMem <= 0) {
  console.log("FAIL: os.totalmem()=" + totalMem);
  passed = false;
}

// os.freemem() should be > 0
const freeMem = os.freemem();
if (freeMem <= 0) {
  console.log("FAIL: os.freemem()=" + freeMem);
  passed = false;
}

// os.uptime() should be > 0
const uptime = os.uptime();
if (uptime <= 0) {
  console.log("FAIL: os.uptime()=" + uptime);
  passed = false;
}

if (passed) {
  console.log("TEST_PASSED");
}
