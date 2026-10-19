# The Milo compiler commit the runtime is built with. Milo moves fast and the runtime's object
# cache key includes this sha, so bumping it rebuilds every runtime object. Upgrade checklist:
# docs/breaking-changes.md in the milo repo. The commit must be reachable on the upstream remote
# (CI fetches it by sha).
MILO_REPO="https://github.com/milo-language/milo"
MILO_COMMIT="424c7e18b8dbf858ef42dd999b81122be728e342"
