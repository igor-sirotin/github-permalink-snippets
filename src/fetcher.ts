import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

export type CacheStatus = 'pending' | 'fulfilled' | 'rejected';

export interface CacheEntry {
  status: CacheStatus;
  content?: string;
  error?: string;
}

export interface ResolvedToken {
  value: string;
  source: 'setting' | 'vscode' | 'env';
  /** Stable identifier for this token — used as part of the cache key so a
   *  token swap invalidates previously-rejected entries. */
  fingerprint: string;
}

export interface FetcherOptions {
  log: vscode.OutputChannel;
  resolveToken: () => Promise<ResolvedToken | undefined>;
  onContentReady: () => void;
}

const USER_AGENT = 'github-permalink-snippets';

function fingerprintToken(value: string): string {
  // Don't keep the raw token in cache keys — just enough to distinguish
  // distinct tokens. Length + first/last 4 chars is plenty.
  if (value.length <= 8) return `len=${value.length}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}/${value.length}`;
}

export class FileFetcher {
  private cache = new Map<string, CacheEntry>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly log: vscode.OutputChannel;
  private readonly resolveToken: () => Promise<ResolvedToken | undefined>;
  private readonly onContentReady: () => void;

  constructor(opts: FetcherOptions) {
    this.log = opts.log;
    this.resolveToken = opts.resolveToken;
    this.onContentReady = opts.onContentReady;
  }

  /**
   * Synchronous accessor used by the markdown-it plugin. Returns the cache
   * entry as it exists right now; if no entry exists, kicks off an async
   * fetch and returns a `pending` entry. When a fetch resolves,
   * `onContentReady` fires (debounced) so the host can refresh the preview.
   *
   * The cache key includes the current token's fingerprint so that signing
   * in (or swapping tokens) invalidates previously-rejected entries
   * automatically — no manual cache flush required.
   */
  get(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    tokenFingerprint: string
  ): CacheEntry {
    const key = `${tokenFingerprint}::${owner}/${repo}/${sha}/${path}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const entry: CacheEntry = { status: 'pending' };
    this.cache.set(key, entry);

    void this.fetchFile(owner, repo, sha, path).then(
      (content) => {
        entry.status = 'fulfilled';
        entry.content = content;
        this.notify();
      },
      (err: unknown) => {
        entry.status = 'rejected';
        entry.error = errorMessage(err);
        this.notify();
      }
    );
    return entry;
  }

  clear(): void {
    this.cache.clear();
  }

  private notify(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.onContentReady();
    }, 100);
  }

  private async fetchFile(
    owner: string,
    repo: string,
    sha: string,
    path: string
  ): Promise<string> {
    const target = `${owner}/${repo}@${sha.slice(0, 7)} ${path}`;
    const token = await this.resolveToken();

    if (token) {
      this.log.appendLine(
        `[fetch] ${target} via api.github.com — auth source=${token.source}, fingerprint=${token.fingerprint}`
      );
      const octokit = new Octokit({
        auth: token.value,
        userAgent: USER_AGENT,
      });
      try {
        const res = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
          ref: sha,
          mediaType: { format: 'raw' },
        });
        // With `format: 'raw'`, the SDK returns the file body as a string in
        // `data`, not the JSON metadata object.
        return res.data as unknown as string;
      } catch (err) {
        const detail = githubErrorDetail(err);
        this.log.appendLine(`[fetch] ${target} FAILED: ${detail}`);
        throw new Error(detail);
      }
    }

    // Unauthenticated path: hit raw.githubusercontent.com directly. This
    // avoids burning the 60/hr unauthenticated api.github.com quota.
    const url =
      'https://raw.githubusercontent.com/' +
      encodeURIComponent(owner) + '/' +
      encodeURIComponent(repo) + '/' +
      encodeURIComponent(sha) + '/' +
      path.split('/').map(encodeURIComponent).join('/');
    this.log.appendLine(`[fetch] ${target} via raw.githubusercontent.com (unauthenticated)`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      const detail = `HTTP ${res.status} from raw.githubusercontent.com`;
      this.log.appendLine(`[fetch] ${target} FAILED: ${detail}`);
      throw new Error(detail);
    }
    return await res.text();
  }
}

export { fingerprintToken };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface OctokitLikeError {
  status?: number;
  message?: string;
  response?: { data?: { message?: string } };
}

function githubErrorDetail(err: unknown): string {
  const e = err as OctokitLikeError;
  const status = e?.status ?? '?';
  const ghMessage =
    e?.response?.data?.message ??
    e?.message ??
    String(err);
  return `HTTP ${status} — ${ghMessage}`;
}
