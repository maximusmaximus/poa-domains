## Summary

<!-- Concise description of the change and its scope within the local reference engine. -->

## Verification Checklist

- [ ] `npm run typecheck` passes (`tsc --noEmit`)
- [ ] `npm test` / `npm run test:coverage` passes (unit, property, and interface suites)
- [ ] `npm run smoke` passes (localhost HTTP, CLI, stdio MCP, headless Chromium UI, and journal replay)
- [ ] `npm run unicode:audit` passes (pinned Unicode 17.0 subset integrity)
- [ ] `npm run security` and `bash scripts/gitleaks.sh` pass with zero findings
- [ ] No private keys, credentials, or external network dependencies introduced
