// Parallel HTTP Fetches - demonstrates async/await with Promise.all

interface Repo {
  stargazers_count: number;
  updated_at: string;
  archived: boolean;
}

async function main(): Promise<void> {
  const results = await Promise.all([
    fetch("https://api.github.com/repos/vuejs/vue"),
    fetch("https://api.github.com/repos/facebook/react"),
  ]);
  const vue = results[0].json<Repo>();
  const react = results[1].json<Repo>();
  console.log(`Vue: ${vue.stargazers_count} stars`);
  console.log(`React: ${react.stargazers_count} stars`);
}

main();
