export function renderMarkdownReport(result) {
  const lines = [
    "# Claude Code Optimizer Audit",
    "",
    `Project: \`${result.cwd}\``,
    "",
    `Status: ${result.issues.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "## Passing Checks",
    "",
    ...(result.passes.length ? result.passes.map((pass) => `- ${pass}`) : ["- None"]),
    "",
    "## Issues",
    "",
    ...(result.issues.length ? result.issues.map((issue) => `- ${issue}`) : ["- None"]),
    "",
  ];

  return lines.join("\n");
}

export function renderSarifReport(result) {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "claude-code-optimizer-pro",
            informationUri: "https://www.npmjs.com/package/claude-code-optimizer-pro",
            rules: [
              {
                id: "cco-audit-issue",
                name: "Claude Code optimizer issue",
                shortDescription: { text: "Claude Code configuration can be optimized" },
              },
            ],
          },
        },
        results: result.issues.map((issue) => ({
          ruleId: "cco-audit-issue",
          level: "warning",
          message: { text: issue },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "CLAUDE.md" },
              },
            },
          ],
        })),
      },
    ],
  };
}
