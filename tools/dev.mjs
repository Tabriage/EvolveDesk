import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["run", "dev:agent"], { stdio: "inherit", env: process.env }),
  spawn("pnpm", ["run", "dev:site"], { stdio: "inherit", env: process.env }),
];

let closing = false;
function shutdown(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!closing && code && code !== 0) {
      console.error(`Development service stopped (${signal || code}).`);
      shutdown();
      process.exitCode = code;
    }
  });
}
