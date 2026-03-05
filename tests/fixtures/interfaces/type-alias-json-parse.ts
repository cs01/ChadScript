type Repo = {
  stargazers_count: number;
  name: string;
};

const json = '{"stargazers_count":42,"name":"vue"}';
const repo = JSON.parse<Repo>(json);
if (repo.stargazers_count === 42 && repo.name === "vue") {
  console.log("TEST_PASSED");
} else {
  console.log("FAIL: " + repo.stargazers_count.toString() + " " + repo.name);
}
