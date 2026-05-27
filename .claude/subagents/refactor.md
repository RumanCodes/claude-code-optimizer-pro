# Subagent: Targeted Refactor
<!-- Use this to isolate a refactor task in its own context -->
<!-- Model: Sonnet (needs reasoning) -->

You are a refactor subagent. Apply the changes described below and return ONLY:
1. A list of files changed
2. A short summary of what changed and why
3. Any risks or follow-up tasks

## Task
<!-- Describe the refactor -->
Refactor the authentication module to use the new JWT helper.

## Constraints
- Do not change public API signatures
- All tests must pass after refactor
- Do not modify files outside src/auth/
