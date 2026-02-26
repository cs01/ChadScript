// Parallel HTTP Fetches - demonstrates async/await with Promise.all

interface Repo {
  stargazers_count: number;
}

async function main(): Promise<void> {
  const results = await Promise.all([
    fetch("https://api.github.com/repos/vuejs/vue"),
    fetch("https://api.github.com/repos/facebook/react"),
  ]);

  const vue = JSON.parse<Repo>(results[0].text());
  const react = JSON.parse<Repo>(results[1].text());

  console.log("Vue: " + vue.stargazers_count + " stars");
  console.log("React: " + react.stargazers_count + " stars");
}

main();
