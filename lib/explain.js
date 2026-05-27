import chalk from "chalk";

const TOPICS = {
  overview: {
    title: "Claude Code optimizer",
    body: [
      "This package keeps Claude Code project context small and stable.",
      "Use init to scaffold config, audit to check it, doctor to repair it, stats to estimate cost, and watch for live feedback.",
    ],
  },
  ".claudeignore": {
    title: ".claudeignore",
    body: [
      "Hides dependency folders, build output, logs, secrets, coverage, and large data files from Claude context.",
      "This lowers token usage and reduces the chance of exposing irrelevant or sensitive files.",
    ],
  },
  "CLAUDE.md": {
    title: "CLAUDE.md",
    body: [
      "Stores high-signal project instructions Claude should always know.",
      "Keep it short because it is repeatedly loaded into Claude Code context.",
    ],
  },
  commands: {
    title: ".claude/commands",
    body: [
      "Stores scoped guidance that should only apply to certain paths or task types.",
      "Move API, UI, test, or package-specific rules here instead of bloating CLAUDE.md.",
    ],
  },
  subagents: {
    title: ".claude/subagents",
    body: [
      "Stores prompt templates for isolated exploration and refactor work.",
      "Subagents can read lots of files and return summaries without polluting the main session.",
    ],
  },
  watch: {
    title: "cco watch",
    body: [
      "Runs live optimizer snapshots while you work.",
      "It reports audit issues, CLAUDE.md token size, risky generated files, secrets, and large root files.",
    ],
  },
  doctor: {
    title: "cco doctor",
    body: [
      "Diagnoses Claude Code config and applies conservative fixes with --fix.",
      "It creates missing optimizer files, fixes ignore entries, caps bash output, and can add npm package publish whitelists.",
    ],
  },
};

export async function explain(topic = "overview") {
  const key = topic === true || !topic ? "overview" : topic;
  const entry = TOPICS[key] || TOPICS.overview;
  console.log(chalk.cyan(`\n${entry.title}\n`));
  entry.body.forEach((line) => console.log(`- ${line}`));
  console.log();
}
