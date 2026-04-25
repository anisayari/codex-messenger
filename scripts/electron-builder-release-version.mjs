import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayVersion } from "../shared/versionUtils.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const releaseVersion = displayVersion(packageJson.version);
const builderBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

const child = spawn(builderBin, process.argv.slice(2), {
  cwd: rootDir,
  env: {
    ...process.env,
    CODEX_MESSENGER_RELEASE_VERSION: releaseVersion
  },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
