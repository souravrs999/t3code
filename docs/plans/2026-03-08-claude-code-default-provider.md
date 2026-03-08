# Claude Code Default Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Claude Code the default provider instead of Codex by merging upstream PR #179 and swapping the default in 3 locations.

**Architecture:** Merge the full Claude Code adapter branch from upstream, then change the default provider constant and its two hardcoded usages to point to `claudeCode`.

**Tech Stack:** TypeScript, Effect, @anthropic-ai/claude-agent-sdk

---

### Task 1: Merge upstream Claude adapter branch

**Step 1: Merge the branch**

```bash
git checkout my-customizations
git merge upstream/codething/648ca884-claude --no-edit
```

**Step 2: Resolve any conflicts if they arise**

The branch is based on upstream main, so conflicts should be minimal. If lockfile conflicts occur, regenerate with `bun install`.

**Step 3: Verify the merge builds**

Run: `bun install && bun typecheck`
Expected: PASS

**Step 4: Commit (if merge was clean, git already committed)**

If conflicts were resolved:
```bash
git add -A
git commit -m "merge: upstream Claude Code adapter (PR #179)"
```

---

### Task 2: Swap default provider constant

**Files:**
- Modify: `packages/contracts/src/orchestration.ts` — change `DEFAULT_PROVIDER_KIND`

**Step 1: Change the constant**

In `packages/contracts/src/orchestration.ts`, change:
```typescript
export const DEFAULT_PROVIDER_KIND: ProviderKind = "codex";
```
to:
```typescript
export const DEFAULT_PROVIDER_KIND: ProviderKind = "claudeCode";
```

**Step 2: Rebuild contracts**

Run: `bun run build:contracts`
Expected: PASS

---

### Task 3: Wire up DEFAULT_PROVIDER_KIND in server

**Files:**
- Modify: `apps/server/src/provider/Layers/ProviderService.ts:252` — replace hardcoded `"codex"`

**Step 1: Replace hardcoded default**

In `apps/server/src/provider/Layers/ProviderService.ts`, find:
```typescript
provider: parsed.provider ?? "codex",
```
Replace with:
```typescript
provider: parsed.provider ?? DEFAULT_PROVIDER_KIND,
```

Add import at the top:
```typescript
import { DEFAULT_PROVIDER_KIND } from "@t3tools/contracts";
```

**Step 2: Typecheck server**

Run: `bun typecheck`
Expected: PASS

---

### Task 4: Wire up DEFAULT_PROVIDER_KIND in web

**Files:**
- Modify: `apps/web/src/components/ChatView.tsx` — replace hardcoded `"codex"` fallback

**Step 1: Replace hardcoded default**

Find the provider selection line:
```typescript
const selectedProvider: ProviderKind = lockedProvider ?? selectedProviderByThreadId ?? "codex";
```
Replace with:
```typescript
const selectedProvider: ProviderKind = lockedProvider ?? selectedProviderByThreadId ?? DEFAULT_PROVIDER_KIND;
```

Add import at the top:
```typescript
import { DEFAULT_PROVIDER_KIND } from "@t3tools/contracts";
```

**Step 2: Typecheck and lint**

Run: `bun typecheck && bun lint`
Expected: PASS

---

### Task 5: Commit and verify

**Step 1: Commit the default swap**

```bash
git add packages/contracts/src/orchestration.ts apps/server/src/provider/Layers/ProviderService.ts apps/web/src/components/ChatView.tsx
git commit -m "feat: make Claude Code the default provider"
```

**Step 2: Run full validation**

Run: `bun typecheck && bun lint && bun run test`
Expected: All pass

**Step 3: Push**

```bash
git push origin my-customizations
```
