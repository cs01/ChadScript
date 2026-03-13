const t = true;
const f = false;

if (t && f) process.exit(1);
if (!(t || f)) process.exit(1);
if (!t) process.exit(1);
if (f) process.exit(1);

const andResult = t && t;
if (!andResult) process.exit(1);

const orResult = f || t;
if (!orResult) process.exit(1);

const notResult = !f;
if (!notResult) process.exit(1);

if (1 > 2) process.exit(1);
if (!(2 > 1)) process.exit(1);
if (1 >= 2) process.exit(1);
if (!(2 >= 2)) process.exit(1);
if (2 < 1) process.exit(1);
if (!(1 < 2)) process.exit(1);
if (2 <= 1) process.exit(1);
if (!(2 <= 2)) process.exit(1);

if (1 === 2) process.exit(1);
if (!(1 === 1)) process.exit(1);
if (1 !== 1) process.exit(1);
if (!(1 !== 2)) process.exit(1);

console.log("TEST_PASSED");
