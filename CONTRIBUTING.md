# Contributing

Thank you for your interest in contributing to Cardinal! Here's how to get started:

- Fork the repository
- Create a feature branch (`git checkout -b feature/your-idea`)
- Make your changes and commit
- Submit a pull request with a description of your changes

## Before you open a PR

This repo contains two independently deployable Cloudflare Workers — the
Telegram bot (root) and the iNaturalist MCP server (`mcp-inaturalist/`). Run
checks from the relevant project directory:

```bash
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest unit tests
npm run build:check  # wrangler deploy --dry-run (offline bundle validation)
```

Please ensure your code follows the existing project conventions (see
[docs/architecture.md](docs/architecture.md)) and include tests for new
behavior where practical.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and
relevant logs (redact any tokens, chat IDs, or coordinates).
