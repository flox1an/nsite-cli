# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript → dist/ and chmod +x dist/cli.js
npm run format     # Format source files with Prettier
```

No test suite exists yet (`npm test` exits with an error).

Enable debug logging during development:
```bash
DEBUG=nsite* node dist/cli.js upload ./my-site
```

## Architecture

**nsite-cli** publishes static websites to the NOSTR protocol. Files are uploaded to Blossom servers (binary blob hosts) and indexed as NOSTR Kind 34128 events signed with the user's private key. Published sites are accessible via nsite gateways (e.g., `https://{npub}.nsite.lol`).

### Command Structure

`src/cli.ts` is the entry point. It registers four commands via Commander.js:
- `upload <folder>` — sync local files to NOSTR+Blossom (`src/commands/upload.ts`)
- `download <folder> <npub>` — fetch remote files (`src/commands/download.ts`)
- `ls [npub]` — list remote files (`src/commands/ls.ts`)
- (no args) — runs interactive setup dialog (`src/setup-project.ts`)

Shared command utilities live in `src/commands/common.ts`: NDK initialization, signer creation from private key, and a simple file logger.

### Key Abstractions

- **`src/config.ts`** — `ProjectData` type + read/write for `.nsite/project.json` (stores private key, relay URLs, Blossom server URLs, publishing flags)
- **`src/files.ts`** — scans local directory, computes SHA256 hashes, diffs local vs remote file lists
- **`src/nostr.ts`** — NDK-based NOSTR operations: publish file events (Kind 34128), profile (Kind 0), relay list (Kind 10002), server list (Kind 10063)
- **`src/blossom.ts`** — Blossom server discovery (reads Kind 10063 events)
- **`src/upload.ts`** — multi-server upload logic using `blossom-client-sdk`
- **`src/proxy.ts`** — PAC file proxy support (Tor/I2P via `PAC_PROXY` env var)

### Upload Data Flow

1. Initialize NDK with relays + signer from private key
2. Scan local folder → compute SHA256 for each file
3. Fetch existing remote file index from NOSTR
4. Diff: find new/changed/deleted files
5. Upload changed files to Blossom servers
6. Publish Kind 34128 NOSTR events for each file
7. Optionally publish profile, relay list, server list events

### NOSTR Event Kind 34128

This is the core nsite file index event. Each event maps a path to a file's SHA256 hash (the Blossom blob address). The full file list for a user is assembled by fetching all their Kind 34128 events.
