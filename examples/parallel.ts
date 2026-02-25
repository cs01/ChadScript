// Parallel HTTP Fetches - demonstrates async/await with Promise.all

interface Repo {
  stargazers_count: number;
}

async function main(): Promise<void> {
  const results = await Promise.all([
    fetch("https://api.github.com/repos/cs01/ChadScript"),
    fetch("https://api.github.com/repos/facebook/react"),
  ]);

  const cs = JSON.parse<Repo>(results[0].text());
  const react = JSON.parse<Repo>(results[1].text());

  console.log("ChadScript: " + cs.stargazers_count + " stars");
  console.log("React: " + react.stargazers_count + " stars");
}

main();
