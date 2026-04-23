import http from "node:http";
import { spawn } from "node:child_process";

const port = 5174;
const url = `http://127.0.0.1:${port}/`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function waitForVite(target, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(target, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Vite did not answer on ${target}`));
          return;
        }
        setTimeout(tick, 250);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

const vite = spawn(npmCommand, ["run", "dev", "--", "--strictPort"], {
  stdio: "inherit",
  shell: false
});

try {
  await waitForVite(url);
  const electron = spawn(npxCommand, ["electron", "."], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url
    }
  });

  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error);
  vite.kill();
  process.exit(1);
}
