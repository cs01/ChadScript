// GitHub Stars CLI - Fetch repository star count using typed JSON
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

// Parse JSON response with type safety
const json = response.json<RepoInfo>();
console.log("Repository:");
console.log(json.name);
console.log("Stars:");
console.log(json.stargazers_count);
