---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "tests/**"
---

# Test Rules
<!-- Loaded only when Claude edits test files -->

- Tests must be deterministic — no random seeds, no Date.now()
- Mock all external HTTP calls
- Each test file tests exactly one module
- Use `describe` / `it` blocks with clear names
- Always test the error path, not just the happy path
