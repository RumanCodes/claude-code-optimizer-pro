import { countTokens as _countTokens } from "@anthropic-ai/tokenizer";

export function estimateTokens(text = "") {
  return _countTokens(text ?? "");
}
