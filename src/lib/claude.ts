import Anthropic from "@anthropic-ai/sdk";
import { LlmError, RULES, type AskOptions, type LlmConnector } from "../core/llm";
import { emptyUsage, type Usage } from "../core/schemas";

export type { Usage };

const MODEL = "claude-opus-5-5";

/**
 * The website's Connector: Claude through the Anthropic API with server-side web search and web fetch
 * (Anthropic's own tools, so no scraping on our side). The answer comes back through a submit tool
 * that holds Claude to the agent's JSON schema.
 */
export function claudeConnector(client: Anthropic): LlmConnector {
  const usage = emptyUsage();
  return {
    id: "anthropic", label: "Claude API", model: MODEL, usage,
    capabilities: { webSearch: true, structured: true, toolCalling: true },
    async ask<T>(prompt: string, opts: AskOptions): Promise<T> {
      const submit: Anthropic.Beta.Messages.BetaTool = {
        name: "submit", description: "Submit your final answer. Call this once, at the end.", strict: true,
        input_schema: opts.schema as Anthropic.Beta.Messages.BetaTool["input_schema"],
      };
      const tools: Anthropic.Beta.Messages.BetaToolUnion[] = opts.web ? [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.searches ?? 10, ...(opts.city ? { user_location: { type: "approximate" as const, city: opts.city } } : {}) },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.max(3, Math.ceil((opts.searches ?? 10) / 2)) },
        submit,
      ] : [submit];
      const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: prompt }];
      let nudged = false;
      for (let turn = 0; turn < 8; turn++) {
        const res = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: RULES,
          tools,
          messages,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        }, { signal: opts.signal });
        usage.inputTokens += res.usage.input_tokens;
        usage.outputTokens += res.usage.output_tokens;
        usage.webSearches += res.usage.server_tool_use?.web_search_requests ?? 0;
        if (res.stop_reason === "refusal") throw new LlmError("Claude declined this request.");
        const done = res.content.find((b) => b.type === "tool_use" && b.name === "submit");
        if (done && done.type === "tool_use") return done.input as T;
        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "pause_turn") continue;
        if (nudged) break;
        nudged = true;
        messages.push({ role: "user", content: "Call submit now with what you found so far." });
      }
      throw new LlmError("Claude did not return results.");
    },
  };
}
