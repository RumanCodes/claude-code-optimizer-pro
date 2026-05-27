export function estimateTokens(text = "") {
  if (!text) return 0;

  const normalized = text.replace(/\r\n/g, "\n");
  const codeFenceCount = (normalized.match(/```/g) || []).length;
  const words = normalized.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  const longWordPenalty = words.reduce((sum, word) => {
    return sum + Math.max(0, Math.ceil(word.length / 12) - 1);
  }, 0);

  return Math.max(1, Math.ceil(words.length * 0.75 + longWordPenalty + codeFenceCount));
}
