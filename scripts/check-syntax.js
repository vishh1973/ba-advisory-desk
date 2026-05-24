const { spawnSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (name.endsWith(".js")) {
      entries.push(fullPath);
    }
  }
  return entries;
}

const files = [
  ...walk("api"),
  "app.js",
  "content.js",
  "config.js",
].filter(Boolean);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`syntax checks passed for ${files.length} files`);
