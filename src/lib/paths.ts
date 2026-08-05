import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * resolve the host agent's state directory across runtimes.
 *
 * omp's agent dir is ~/.omp/agent, pi's is ~/.pi/agent. both honour
 * PI_CODING_AGENT_DIR when set. otherwise fall back by executable name,
 * then by whichever directory already exists (covers bun-launched dev
 * sessions where execPath is the bun binary).
 */
export function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  const exe = basename(process.execPath).toLowerCase();
  if (exe.includes("omp")) return join(homedir(), ".omp", "agent");
  if (exe.includes("pi")) return join(homedir(), ".pi", "agent");
  const ompDir = join(homedir(), ".omp", "agent");
  return existsSync(ompDir) ? ompDir : join(homedir(), ".pi", "agent");
}
