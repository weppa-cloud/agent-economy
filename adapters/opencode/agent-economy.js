// agent-economy for OpenCode: runs the shared guard before every shell call.
// Installed to .opencode/plugin/agent-economy.js; the guard lives in .agent-economy/hooks/.
import { evaluate } from "../../.agent-economy/hooks/guard.mjs";

/** @type {import("@opencode-ai/plugin").Plugin} */
export const AgentEconomy = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return;
    let result;
    try {
      result = evaluate({ tool_name: "bash", tool_input: output.args, cwd: directory }, { harness: "opencode" });
    } catch {
      return; // fail open
    }
    const allow = (process.env.AGENT_ECONOMY_ALLOW || "").trim();
    if (result.decision === "deny" && !allow) throw new Error(result.reason);
  },
});
