# GitHub Permalink Snippets

A VS Code extension that renders GitHub permalinks as inline code snippets in
the Markdown preview — the same way GitHub itself does in issue comments and
pull request descriptions.

## What it does

Drop a GitHub permalink on its own line in any Markdown file:

```
https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L20-L35
```

Open the Markdown preview and the URL is replaced with a snippet card showing
the file path, the requested line range, and the actual code at that revision.

Supported URL shapes (must be on their own paragraph):

| Shape | Example |
|---|---|
| Single line  | `…/blob/<sha>/<path>#L16` |
| Range        | `…/blob/<sha>/<path>#L20-L35` |
| Whole file   | `…/blob/<sha>/<path>` |

The SHA must be a 7-40 character hex commit SHA (true permalinks). Branch- or
tag-based URLs are intentionally not transformed, since they are not stable.

Inline links (`[text](url)`) and non-permalink GitHub URLs are left untouched.

## How it works

- A `markdown-it` plugin in the extension host scans the token stream for
  paragraphs whose only content is a GitHub permalink URL.
- For each match the plugin asks an in-process file cache for the source.
  - **Cache hit** → the snippet card HTML is rendered straight into the
    Markdown output.
  - **Cache miss** → the cache returns a `pending` entry, the plugin emits a
    "Loading…" placeholder, and an async fetch is kicked off in the
    extension host (Node.js `fetch`, full network access).
- When a fetch resolves, the extension calls
  `markdown.preview.refresh` so VS Code re-renders any open Markdown
  preview; the second pass hits the cache and emits the real snippet.
- The Markdown preview webview is **never asked to make any network
  requests**, so it doesn't run into the preview's strict Content Security
  Policy (which blocks `connect-src` to anything other than `'self'`).

## Authentication

For public repos no setup is needed. For **private repos**, the extension
resolves a GitHub credential in this order:

1. The `githubPermalinkSnippets.githubToken` setting, if non-empty
   (whitespace-trimmed).
2. VS Code's built-in GitHub session (recommended). Run **Markdown GitHub
   Permalinks: Sign In with GitHub** from the command palette to create one
   if you aren't already signed in. Disable with
   `githubPermalinkSnippets.useVsCodeGitHubAuth: false` if you don't want
   the extension to touch your VS Code GitHub session.
3. The `GITHUB_TOKEN` environment variable (useful in CI / dev containers).

Network requests are made through [Octokit](https://github.com/octokit) in
the **extension host** — never in the Markdown preview webview — so the
preview's strict CSP doesn't get in the way and the token is never exposed
to webview-rendered HTML.

### Minimum scopes (when using a personal access token)

| Token type | Minimum scope |
|---|---|
| **Fine-grained PAT** | **Contents** → **Read-only** on each target repository |
| **Classic PAT** | `repo` for private repos, or `public_repo` for public-only |

VS Code's GitHub session is requested with the `repo` scope, which covers
both public and private repos.

## Commands

All available from the command palette:

| Command | What it does |
|---|---|
| **GitHub Permalink Snippets: Sign In with GitHub** | Creates a VS Code GitHub session (with `repo` scope) if one doesn't already exist. |
| **GitHub Permalink Snippets: Show Log** | Reveals the extension's Output channel — every fetch attempt, auth source used, and error from GitHub is logged here. |
| **GitHub Permalink Snippets: Clear Snippet Cache** | Drops the in-memory file cache and refreshes any open Markdown preview. Useful after a permalink target has been updated. |

## Diagnostics

If a snippet card shows `Failed to load: HTTP …`, run **Markdown GitHub
Permalinks: Show Log** for the full error from GitHub. Common cases:

- **`HTTP 401 — Bad credentials`** — the configured token is invalid,
  expired, or has whitespace from paste. Re-check
  `githubPermalinkSnippets.githubToken`, or sign back in with
  **Sign In with GitHub**.
- **`HTTP 404`** — either the repo/file/SHA truly doesn't exist, or you're
  unauthenticated and the repo is private. Sign in or set a token with
  read access to the target repo.
- **`HTTP 403` with `rate limit exceeded`** — only happens on the
  authenticated path (`api.github.com`). Wait for the reset window or use
  a token if you've been getting unauthenticated rate-limited.

## Limitations

- **No syntax highlighting (yet).** Code is rendered with the editor's
  monospace font but without colorization. The language is detected from the
  file extension and applied as a `language-*` class so a follow-up can plug
  in `highlight.js` or Shiki.
- **Bare-URL paragraphs only.** Permalinks must be on their own line, with no
  surrounding text in the same paragraph (this matches GitHub's own behavior).

## Try it locally

You need Node.js and a recent VS Code.

```bash
git clone https://github.com/igor-sirotin/github-permalink-snippets.git
cd github-permalink-snippets
npm install
npm run compile
```

Then open the folder in VS Code and press <kbd>F5</kbd> ("Run Extension"). A
second VS Code window — the **Extension Development Host** — opens with this
extension loaded.

In that window:

1. Open `sample.md` from this repo (or any Markdown file with a GitHub
   permalink on its own line).
2. Open the Markdown preview: <kbd>⌘K V</kbd> on macOS, <kbd>Ctrl+K V</kbd>
   elsewhere — or run **Markdown: Open Preview to the Side**.
3. The permalink should render as a code snippet card. Edit the file; the
   preview updates live.

If you don't see the snippet, check:

- The URL is on its own paragraph (blank lines above and below).
- The ref is a commit SHA, not a branch or tag.
- The repo is public, **or** you've configured a token with access to it
  (see "GitHub Token" above). Otherwise the snippet renders a "Failed to
  load: HTTP 404" card.

On first open you may briefly see a "Loading…" card; once the file is
fetched in the extension host, the preview auto-refreshes and the snippet
appears. Subsequent renders hit the in-memory cache and show the snippet
immediately.

### Iterating

- `npm run watch` rebuilds on save.
- After changes to the extension's TypeScript, reload the Extension
  Development Host (<kbd>⌘R</kbd> / <kbd>Ctrl+R</kbd>).
- Changes to `preview/permalinks.css` are picked up by re-opening the
  preview.

## Repository layout

```
src/
  extension.ts            entry point — wires fetcher + plugin, listens
                          for token config changes, refreshes preview
                          when fetches resolve
  markdownItPlugin.ts     core ruler that swaps permalink paragraphs for
                          rendered snippet cards (or loading/error
                          placeholders) using the cache
  fetcher.ts              in-memory cache + async file fetcher running
                          in the extension host (Node.js fetch)
preview/
  permalinks.css          styling, theme-aware via VS Code CSS variables
sample.md                 demo file with a few permalinks
```

## License

MIT — see `LICENSE`.
