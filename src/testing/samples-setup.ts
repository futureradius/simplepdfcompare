// Vitest global setup: writes the synthetic pairs and ground-truth.json (`npm run samples`)
// when they are missing, so the tests against the ground truth never skip silently.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export default function setup(): void {
  if (existsSync("samples/ground-truth.json")) return;
  execFileSync(process.execPath, ["scripts/make-sample-plans.mjs"], { stdio: "inherit" });
}
