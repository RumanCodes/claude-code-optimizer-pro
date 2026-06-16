export function normalizeIgnoreLine(line) {
  if (!line) return "";
  let normalized = line.replace(/\\+/g, "/").trim();
  const commentIndex = normalized.indexOf("#");
  if (commentIndex >= 0) normalized = normalized.slice(0, commentIndex).trim();
  if (normalized === "") return "";
  if (normalized.startsWith("#")) return "";
  if (normalized.startsWith("!")) normalized = normalized.slice(1).trim();
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}

export function parseIgnoreContent(content) {
  return content
    .split(/\r?\n/)
    .map((line) => normalizeIgnoreLine(line))
    .filter((line) => line.length > 0);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ignoreLineMatches(line, requiredEntry) {
  const normalizedLine = normalizeIgnoreLine(line);
  const required = normalizeIgnoreLine(requiredEntry);

  if (!normalizedLine || !required) return false;
  if (normalizedLine === required) return true;
  if (normalizedLine === `${required}/`) return true;
  if (normalizedLine.startsWith(`${required}/`)) return true;
  if (normalizedLine.endsWith(`/${required}`) || normalizedLine.endsWith(`/${required}/`)) return true;

  if (required.includes("*")) {
    const pattern = `^${escapeRegex(required).replace(/\\\*/g, ".*")}$`;
    const matcher = new RegExp(pattern);
    return matcher.test(normalizedLine);
  }

  return false;
}

export function findMissingIgnoreEntries(ignoreContent, requiredEntries = []) {
  const lines = parseIgnoreContent(ignoreContent || "");
  return requiredEntries.filter((required) => !lines.some((line) => ignoreLineMatches(line, required)));
}
