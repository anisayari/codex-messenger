import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayVersion } from "../shared/versionUtils.js";

export function builderInvocation(rootDir, args, nodeExecutable = process.execPath) {
  return { command: nodeExecutable, args: [path.join(rootDir, "node_modules", "electron-builder", "cli.js"), ...args] };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const invocation = builderInvocation(rootDir, process.argv.slice(2));
  const child = spawn(invocation.command, invocation.args, {
    cwd: rootDir,
    env: { ...process.env, CODEX_MESSENGER_RELEASE_VERSION: displayVersion(packageJson.version) },
    shell: false,
    stdio: "inherit"
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("close", (code) => { process.exitCode = code === 0 ? 0 : 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
