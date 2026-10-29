// Builds the CLI and puts the npm package at public/cli/masar-cli.tgz, so the website serves it:
//   npm install -g https://<site>/cli/masar-cli.tgz
// Runs before `next build`. A failure here is reported but never stops the website from deploying.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(cli, "..");
const out = path.join(root, "public", "cli");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  rmSync(path.join(cli, "dist"), { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", cli], { stdio: "inherit" });
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (f.endsWith(".tgz")) rmSync(path.join(out, f));
  const name = execFileSync(npm, ["pack", "--silent", "--pack-destination", out], { cwd: cli, encoding: "utf8", shell: process.platform === "win32" }).trim().split("\n").pop();
  renameSync(path.join(out, name), path.join(out, "masar-cli.tgz"));
  console.log("[masar] CLI package ready at public/cli/masar-cli.tgz");
} catch (e) {
  console.warn("[masar] Could not build the CLI package; the website still deploys.", e instanceof Error ? e.message : e);
}
