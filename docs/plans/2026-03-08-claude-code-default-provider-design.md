# Design: Make Claude Code the Default Provider

**Date:** 2026-03-08
**Status:** Approved

## Goal

Switch the default provider from Codex to Claude Code so the app uses Claude Code CLI out of the box.

## Approach

Merge upstream PR #179 (`codething/648ca884-claude`) which adds the full Claude Code adapter, then swap the default provider in 3 locations.

### Step 1: Merge Claude adapter branch

Merge `upstream/codething/648ca884-claude` into `my-customizations`. This brings in:
- `ClaudeCodeAdapter` server-side implementation
- Claude Code schemas and contracts
- Provider registry wiring
- UI surface for Claude Code provider selection
- `@anthropic-ai/claude-agent-sdk` dependency

### Step 2: Swap default provider (3 files)

1. **`packages/contracts/src/orchestration.ts`** — Change `DEFAULT_PROVIDER_KIND` from `"codex"` to `"claudeCode"`
2. **`apps/server/src/provider/Layers/ProviderService.ts`** — Import and use `DEFAULT_PROVIDER_KIND` instead of hardcoded `"codex"`
3. **`apps/web/src/components/ChatView.tsx`** — Import and use `DEFAULT_PROVIDER_KIND` instead of hardcoded `"codex"`

## Sync Strategy

- Upstream auto-syncs to `main` daily via GitHub Action
- When PR #179 merges upstream, rebasing `my-customizations` onto `main` will auto-resolve since we share the same commit history
- Only the default-swap commit remains as our custom patch

## Custom diff size

~10 lines across 3 files.
