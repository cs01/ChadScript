async function main() {
  const a = fetch("https://api.example.com/users");
  const b = fetch("https://api.example.com/posts");
  const [users, posts] = await Promise.all([a, b]);
  console.log("users: " + users.status);
  console.log("posts: " + posts.status);
}

main();
