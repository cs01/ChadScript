// Parallel HTTP Fetches - demonstrates async/await with Promise.all

console.log("Parallel Fetch Demo");
console.log("  fetching two URLs concurrently with Promise.all...");
console.log("");

async function main(): Promise<void> {
  const a = fetch("https://api.example.com/users");
  const b = fetch("https://api.example.com/posts");
  const [users, posts] = await Promise.all([a, b]);

  console.log("Results:");
  console.log("  https://api.example.com/users -> " + users.status);
  console.log("  https://api.example.com/posts -> " + posts.status);
}

main();
