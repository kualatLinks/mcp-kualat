# Changelog

All notable changes to `@kualat/mcp` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-03

### Added

- Rewritten from PHP to TypeScript on Node.js 18+, published to npm as
  `@kualat/mcp` instead of Packagist. Protocol handling now uses the official
  `@modelcontextprotocol/sdk`; the HTTP client uses the built-in `fetch`.
- The `kualat-mcp` command, its flags, the environment variables, and the
  eleven tools are unchanged.
- `create_webhook` documents the Standard Webhooks signing scheme
  (`whsec_` secret, HMAC-SHA256 over `{id}.{timestamp}.{payload}`).
