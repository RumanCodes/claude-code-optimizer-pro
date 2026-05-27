---
paths:
  - "src/ui/**"
  - "src/components/**"
  - "app/**/*.tsx"
---

# UI Rules
<!-- Loaded only when Claude edits UI files -->

- Components are functional only — no class components
- All user-facing strings go through i18n helpers
- Images must have alt text
- Interactive elements need keyboard support
- Never inline styles — use the design system tokens
