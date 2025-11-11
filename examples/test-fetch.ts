// Test fetch with a URL that doesn't need DNS
console.log("Testing fetch...");
const response = fetch("http://localhost:9999");
console.log("Response:");
console.log(response);
console.log("Done!");
