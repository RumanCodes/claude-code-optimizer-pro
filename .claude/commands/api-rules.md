---
paths:
  - "src/api/**/*.ts"
  - "app/api/**/*.ts"
---

# API Rules
<!-- Loaded only when Claude edits API files — saves tokens elsewhere -->

- Validate all inputs at the route boundary
- Use the shared `ApiError` class for all error responses
- Every route needs an auth guard unless explicitly public
- Add integration tests for authorization failures
- Log request IDs for traceability
