/**
 * Estimated USD cost from token usage.
 * Defaults follow https://platform.openai.com/docs/pricing (per-model branches below).
 * Override with env if OpenAI changes prices.
 */
export function openaiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const m = model.toLowerCase();
  let inPerM = 2.5;
  let outPerM = 10.0;

  if (m.includes("gpt-5-nano")) {
    inPerM = parseFloat(process.env.OPENAI_GPT5_NANO_INPUT_USD_PER_MTOK || "0.05");
    outPerM = parseFloat(process.env.OPENAI_GPT5_NANO_OUTPUT_USD_PER_MTOK || "0.4");
  } else if (m.includes("gpt-5-mini")) {
    inPerM = parseFloat(process.env.OPENAI_GPT5_MINI_INPUT_USD_PER_MTOK || "0.25");
    outPerM = parseFloat(process.env.OPENAI_GPT5_MINI_OUTPUT_USD_PER_MTOK || "2");
  } else if (m.includes("gpt-4o") && !m.includes("mini")) {
    inPerM = parseFloat(process.env.OPENAI_GPT4O_INPUT_USD_PER_MTOK || "2.5");
    outPerM = parseFloat(process.env.OPENAI_GPT4O_OUTPUT_USD_PER_MTOK || "10");
  } else if (m.includes("gpt-4o-mini")) {
    inPerM = parseFloat(process.env.OPENAI_GPT4O_MINI_INPUT_USD_PER_MTOK || "0.15");
    outPerM = parseFloat(process.env.OPENAI_GPT4O_MINI_OUTPUT_USD_PER_MTOK || "0.6");
  }

  const inCost = (inputTokens / 1_000_000) * inPerM;
  const outCost = (outputTokens / 1_000_000) * outPerM;
  return Number((inCost + outCost).toFixed(6));
}
