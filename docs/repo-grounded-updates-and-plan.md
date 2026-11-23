# Repo-Grounded Documentation, Roadmap & Plan Updates (`@resciencelab/star-office-world`)

- **Target Package & Version:** `@resciencelab/star-office-world` (`v0.2.4`)
- **Workspace:** `default_workspace` (`src/`, `test/`, `frontend/`, `README.md`, `SPEC.md`, `CHANGELOG.md`, `world.yaml`, `package.json`)
- **SDK Baseline:** `@resciencelab/agent-world-sdk` `^1.6.0` (upgraded from `1.3.1` -> `1.5.0` -> `1.5.1` -> `1.6.0`)

---

## 1. Change Summary (Repo-Grounded Audit)

A comparison of current repository artifacts (`package.json`, `world.yaml`, `CHANGELOG.md`, `src/*`, `test/*.test.mjs`) against `README.md` and `SPEC.md` identifies several drift points that should be reconciled in documentation and planning artifacts:

1. **Environment Variable Precedence & Names (`CHANGELOG.md` 0.2.2 vs. `README.md` / `SPEC.md`):**
   - `CHANGELOG.md` (`0.2.2`) documents that platform-aligned variables (`WORLD_ID`, `WORLD_NAME`, `WORLD_PASSWORD`, `MAX_AGENTS`, `WORLD_PUBLIC`) now take precedence over legacy `STAR_OFFICE_*` aliases, and adds `isPublic` config support.
   - `README.md` and `SPEC.md` still present legacy `STAR_OFFICE_*` variables as primary without documenting `WORLD_ID`, `WORLD_NAME`, `WORLD_PASSWORD`, `MAX_AGENTS`, `WORLD_PUBLIC`, `GATEWAY_URL`, or `STAR_OFFICE_LANG`.
2. **SDK & Route / CLI Terminology (`CHANGELOG.md` 0.1.2 / 0.2.3 & `package.json`):**
   - `@resciencelab/agent-world-sdk` is at `^1.6.0` (carrying v1.4.0 Rust `awn` CLI, `peer` -> `agent`/`world` terminology, gateway endpoint updates `/peer/*` -> `/agents`, `/messages`, `/ping`, and v1.5.0 manifest endpoint).
   - `package.json` defines `mcp:antigravity` (`node dist/integrations/antigravity/mcp/mcp-entry.js`), `test` (`npm run build && node --test test/*.test.mjs`), `lint` (`tsc --noEmit`), and `version` (`changeset version && node scripts/sync-world-version.mjs`), whereas `SPEC.md` reflects earlier scaffold assumptions (`test/*.test.ts`, `/peer/*` routes, and pre-Antigravity/pre-v1.6.0 layout).
3. **Source Layout & Subsystems (`src/`):**
   - Active modules under `src/` include `agents`, `ai`, `config.ts`, `diagnostics`, `discover.ts`, `hooks.ts`, `index.ts`, `integrations`, `memo-store.ts`, `sse.ts`, `state.ts`, `types.ts`, and `ui-routes.ts` (alongside `gemini-reverse: ^2.1.0` in `package.json`).
   - `SPEC.md` §6 and §10 list planned/earlier modules (`actions.ts`, `admin-routes.ts`, `background.ts`, `utils.ts`) and check-boxed phases that have evolved alongside `0.1.0`–`0.2.4` releases.

---

## 2. Section-by-Section Diffs

### 2.1 `README.md` — Configuration & Runtime Alignment Diff

```diff
 ## Configuration
 
-Environment variables:
+Environment variables (platform-aligned `WORLD_*` keys take precedence over legacy `STAR_OFFICE_*` aliases as of `0.2.2`):
 
 | Variable | Default | Description |
 |----------|---------|-------------|
-| `STAR_OFFICE_PORT` | `19000` | Server port |
-| `STAR_OFFICE_NAME` | `Star Office` | Office display name |
-| `STAR_OFFICE_PASSWORD` | (empty) | AWN join password |
+| `WORLD_ID` | (auto-derived slug) | Unique world identifier (platform-injected or derived from keypair slug) |
+| `WORLD_NAME` / `STAR_OFFICE_NAME` | `Star Office` | Office display name (`WORLD_NAME` takes precedence) |
+| `WORLD_PASSWORD` / `STAR_OFFICE_PASSWORD` | (empty) | AWN join password (`WORLD_PASSWORD` takes precedence) |
+| `MAX_AGENTS` | `20` | Maximum concurrent agents (`MAX_AGENTS` takes precedence) |
+| `WORLD_PUBLIC` | — | Public visibility setting (`isPublic` config support) |
+| `STAR_OFFICE_PORT` | `19000` | Server port |
 | `STAR_OFFICE_ADMIN_PASS` | `1234` | Browser admin password |
-| `STAR_OFFICE_PUBLIC_ADDR` | — | Public hostname for gateway |
-| `STAR_OFFICE_GATEWAY_URLS` | — | AWN gateway URLs (comma-sep) |
+| `STAR_OFFICE_PUBLIC_ADDR` | (auto-discovered) | Public hostname/IP for gateway announce (auto-detected if unset) |
+| `GATEWAY_URL` / `STAR_OFFICE_GATEWAY_URLS` | (production default) | AWN gateway URL(s) |
+| `STAR_OFFICE_MAIN_AGENT_ID` | — | Primary/main agent ID designation |
+| `STAR_OFFICE_LANG` | `cn` | Display language (`cn` \| `en` \| `jp`) |
 | `STAR_OFFICE_DATA_DIR` | `./data` | Data persistence directory |
 | `GEMINI_API_KEY` | — | For AI background generation |
```

### 2.2 `SPEC.md` — Architecture, Source Tree & Roadmap Phase Diff

```diff
 ## 6. Project Structure
 
 ```text
 star-office-world/
 ├── package.json
 ├── tsconfig.json
+├── world.yaml
 ├── src/
-│   ├── index.ts              # Entry point — createStarOfficeWorld()
-│   ├── config.ts             # StarOfficeConfig type & env loading
-│   ├── state.ts              # OfficeWorldState management
-│   ├── hooks.ts              # WorldHooks implementation
-│   ├── actions.ts            # Action handlers (set_state, post_memo, etc.)
-│   ├── sse.ts                # SSE connection manager
-│   ├── ui-routes.ts          # Browser-facing REST + SSE routes
-│   ├── admin-routes.ts       # Admin endpoints (background, config)
-│   ├── memo-store.ts         # Daily memo persistence
-│   ├── background.ts         # Background management + Gemini integration
-│   └── utils.ts              # State normalization, area mapping
+│   ├── index.ts              # Entry point — createStarOfficeWorld()
+│   ├── config.ts             # StarOfficeConfig & env precedence (WORLD_* / STAR_OFFICE_*)
+│   ├── state.ts              # OfficeWorldState management & persistence
+│   ├── hooks.ts              # WorldHooks implementation
+│   ├── sse.ts                # SSE connection manager
+│   ├── ui-routes.ts          # Browser-facing REST, SSE & admin routes
+│   ├── memo-store.ts         # Daily memo persistence
+│   ├── types.ts              # Shared domain & config types
+│   ├── discover.ts           # Gateway / peer discovery helpers
+│   ├── agents/               # Agent lifecycle & host/main agent helpers
+│   ├── ai/                   # AI / Gemini background & generation helpers
+│   ├── diagnostics/          # Runtime diagnostics & health helpers
+│   └── integrations/         # External integrations (e.g. Antigravity MCP)
 ├── frontend/
 ...
 └── test/
-    ├── hooks.test.ts         # Action handler tests
-    ├── state.test.ts         # State machine tests
-    ├── sse.test.ts           # SSE delivery tests
-    └── integration.test.ts   # Full server integration tests
+    └── *.test.mjs            # Built Node test runner suite (npm test)
 ```
```

```diff
 ## 10. Implementation Phases
 
 ### Phase 1: Core Server (MVP)
-- [ ] `createStarOfficeWorld()` with `createWorldServer`
-- [ ] World hooks: `onJoin`, `onAction` (set_state, heartbeat), `onLeave`
-- [ ] In-memory `OfficeWorldState` with area mapping
-- [ ] `GET /ui/state` REST endpoint
-- [ ] `GET /ui/events` SSE stream
-- [ ] Static file serving for frontend
-- [ ] Frontend: replace polling with SSE in `game.js`
-- [ ] Basic tests
+- [x] `createStarOfficeWorld()` with `createWorldServer` (`@resciencelab/agent-world-sdk` ^1.6.0)
+- [x] World hooks, state persistence, SSE stream, and frontend static serving
+- [x] Versioned Phaser sprite frames & texture fixes (`0.2.4`)
 
 ### Phase 2: Memo & Admin
-- [ ] `post_memo` action + daily memo persistence
-- [ ] `GET /ui/memo/yesterday` + `GET /ui/memo/today`
-- [ ] Admin login + session auth
-- [ ] Admin config endpoint
-- [ ] Background upload endpoint
+- [x] Daily memo persistence & live memo feed (`0.1.0`)
+- [ ] Complete admin auth/config/background upload hardening & test coverage
 
 ### Phase 3: AI Background Generation
-- [ ] Gemini integration (port from Flask)
-- [ ] Async task system for generation
-- [ ] Poll endpoint for progress
-- [ ] Background history / favorites
+- [ ] `src/ai/` & `gemini-reverse` integration refinement, async task polling, and history/favorites
 
 ### Phase 4: Compatibility, Integrations & Hardening
-- [ ] Compat shim for `set_state.py` and `office-agent-push.py`
-- [ ] Agent Card (`.well-known/agent.json`)
-- [ ] Electron desktop-pet wrapper updates
-- [ ] i18n for SSE event messages
-- [ ] Production hardening (rate limits, CORS, CSP)
+- [x] Platform env alignment (`WORLD_*` precedence), auto-derived slug (`0.2.1`), IP discovery (`0.2.0`), Antigravity MCP entry (`src/integrations/antigravity/mcp/mcp-entry.js`)
+- [ ] Complete `awn` CLI (`v1.4.0+`) / manifest endpoint (`v1.5.0+`) alignment, rate limits/CSP hardening, and expanded `test/*.test.mjs` coverage
```

---

## 3. Roadmap & Execution Plan

1. **Documentation & Env Contract Sync (`README.md`, `SPEC.md`, `world.yaml`):**
   - Document `WORLD_ID`, `WORLD_NAME`, `WORLD_PASSWORD`, `MAX_AGENTS`, `WORLD_PUBLIC`, `GATEWAY_URL`, and `STAR_OFFICE_LANG` alongside legacy `STAR_OFFICE_*` aliases and precedence rules.
   - Update source tree and test command references (`npm run build && node --test test/*.test.mjs`, `npm run lint`, `npm run mcp:antigravity`).
2. **SDK v1.6.0 & Gateway Alignment:**
   - Audit `src/discover.ts`, `src/hooks.ts`, and `src/ui-routes.ts` against `@resciencelab/agent-world-sdk` `1.6.0` (`awn` CLI, world manifest endpoint, and updated gateway endpoints).
3. **Subsystems & Test Expansion (`src/agents/`, `src/ai/`, `src/diagnostics/`, `src/integrations/`, `test/*.test.mjs`):**
   - Add targeted unit and integration tests in `test/*.test.mjs` covering env precedence, state/area transitions, memo persistence, SSE delivery, and Antigravity MCP integration.

---

## 4. Proposed Changelog Block (`CHANGELOG.md`)

```markdown
## Unreleased

### Documentation & Planning

- Reconcile `README.md` and `SPEC.md` with `0.2.2`–`0.2.4` changes, documenting `WORLD_*` environment variable precedence over legacy `STAR_OFFICE_*` aliases, `isPublic` support, `src/` subsystem layout (`agents/`, `ai/`, `diagnostics/`, `integrations/`, `discover.ts`, `types.ts`), and `test/*.test.mjs` / `mcp:antigravity` scripts.
- Outline next-step roadmap items for SDK `1.6.0` manifest/CLI alignment, `src/ai/` background generation workflows, and expanded automated test coverage.
```
