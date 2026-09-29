import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`)));
  });
}

await run(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build", "--config", "vite.config.ts"]);

await mkdir(resolve(root, "api"), { recursive: true });
await rm(resolve(root, "api", "actions.ts"), { force: true });
await rm(resolve(root, "api", "actions.js"), { force: true });

await build({
  entryPoints: [resolve(root, "server", "vercel-entry.ts")],
  outfile: resolve(root, "api", "actions.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
  alias: {
    "@space/privileged": resolve(root, "server", ".generated", "privileged.contract.ts"),
  },
  external: ["node:*", "sql.js", "sql.js/*"],
  logLevel: "info",
});
