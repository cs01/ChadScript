// GitHub Stars CLI - Fetch repository star count using JSON.parse()
// Usage: ./github-stars owner/repo
//
// Example: ./github-stars facebook/react

interface RepoInfo {
  stargazers_count: number;
  name: string;
}

// Get repo from command line args
if (process.argv.length < 2) {
  console.log("Usage: github-stars owner/repo");
  console.log("Example: github-stars facebook/react");
  process.exit(1);
}

const repo = process.argv[1];

// Fetch GitHub API
const url = "https://api.github.com/repos/" + repo;
const response = fetch(url);

// Parse JSON response and print star count
const json = JSON.parse<RepoInfo>(response);
console.log("stars:")
console.log(json.stargazers_count);
