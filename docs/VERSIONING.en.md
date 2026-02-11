# Versioning Policy

AIStack follows **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`

## Current

- Initial public release: `0.1.0`

## Rules

- `MAJOR`: breaking changes in public APIs, MCP tool schemas, or extension behavior
- `MINOR`: backward-compatible features (new MCP tools, new workflow stages, new UI settings)
- `PATCH`: backward-compatible fixes, docs-only improvements, security fixes without API break

## Pre-1.0 Guidance

Before `1.0.0`, breaking changes may still happen in `MINOR`, but release notes must clearly mark breakage.

Suggested cadence:

- `0.1.x`: stabilization and bugfixes
- `0.2.x`: workflow expansion (brainstorm/debate/synthesis controls)
- `0.3.x`: hardening (permission model, sandboxing, observability)
- `1.0.0`: stable schemas + migration policy + compatibility guarantees

## Tagging

- Use annotated tags with `v` prefix:
  - `v0.1.0`
  - `v0.1.1`
  - `v0.2.0`

## Release Notes Template

Each release should include:

1. Highlights
2. Breaking Changes
3. Migration Notes
4. Verification Status

