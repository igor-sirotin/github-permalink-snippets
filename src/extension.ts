import * as vscode from 'vscode';
import type MarkdownIt from 'markdown-it';
import { permalinksPlugin } from './markdownItPlugin';
import { FileFetcher, fingerprintToken, ResolvedToken } from './fetcher';

const CONFIG_SECTION = 'githubPermalinkSnippets';

let log: vscode.OutputChannel | undefined;
let fetcher: FileFetcher | undefined;
let lastFingerprint = '';

async function resolveToken(): Promise<ResolvedToken | undefined> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const fromSetting = (cfg.get<string>('githubToken', '') || '').trim();
  if (fromSetting) {
    return {
      value: fromSetting,
      source: 'setting',
      fingerprint: 'setting:' + fingerprintToken(fromSetting),
    };
  }

  const useVsCode = cfg.get<boolean>('useVsCodeGitHubAuth', true);
  if (useVsCode) {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['repo'],
        { silent: true }
      );
      if (session) {
        return {
          value: session.accessToken,
          source: 'vscode',
          fingerprint: `vscode:${session.account.label}:${session.id}`,
        };
      }
    } catch (err) {
      log?.appendLine(
        `[auth] vscode.authentication.getSession failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const fromEnv = (process.env.GITHUB_TOKEN || '').trim();
  if (fromEnv) {
    return {
      value: fromEnv,
      source: 'env',
      fingerprint: 'env:' + fingerprintToken(fromEnv),
    };
  }

  return undefined;
}

async function refreshFingerprint(): Promise<void> {
  const token = await resolveToken();
  const next = token ? token.fingerprint : '';
  if (next !== lastFingerprint) {
    log?.appendLine(
      `[auth] token changed: ${lastFingerprint || '(none)'} -> ${next || '(none)'}`
    );
    lastFingerprint = next;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel('GitHub Permalink Snippets');
  context.subscriptions.push(log);
  log.appendLine('[lifecycle] extension activated');

  await refreshFingerprint();

  fetcher = new FileFetcher({
    log,
    resolveToken,
    onContentReady: () => {
      void vscode.commands.executeCommand('markdown.preview.refresh');
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (
        e.affectsConfiguration(`${CONFIG_SECTION}.githubToken`) ||
        e.affectsConfiguration(`${CONFIG_SECTION}.useVsCodeGitHubAuth`)
      ) {
        await refreshFingerprint();
        // Markdown plugin reads the new fingerprint on its next render,
        // so previously-rejected entries (under the old fingerprint) get
        // bypassed automatically. Force an immediate re-render so the
        // user doesn't have to edit the file.
        void vscode.commands.executeCommand('markdown.preview.refresh');
      }
    })
  );

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(async (e) => {
      if (e.provider.id !== 'github') return;
      await refreshFingerprint();
      void vscode.commands.executeCommand('markdown.preview.refresh');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${CONFIG_SECTION}.signIn`,
      async () => {
        try {
          const session = await vscode.authentication.getSession(
            'github',
            ['repo'],
            { createIfNone: true }
          );
          if (session) {
            log?.appendLine(
              `[auth] signed in as ${session.account.label}`
            );
            await refreshFingerprint();
            void vscode.window.showInformationMessage(
              `Signed in to GitHub as ${session.account.label}.`
            );
            void vscode.commands.executeCommand('markdown.preview.refresh');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log?.appendLine(`[auth] sign-in failed: ${msg}`);
          void vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${CONFIG_SECTION}.showLog`, () => {
      log?.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${CONFIG_SECTION}.clearCache`, () => {
      fetcher?.clear();
      log?.appendLine('[cache] cleared by user command');
      void vscode.commands.executeCommand('markdown.preview.refresh');
    })
  );

  return {
    extendMarkdownIt(md: MarkdownIt) {
      return md.use(permalinksPlugin, {
        fetcher: fetcher!,
        getTokenFingerprint: () => lastFingerprint,
      });
    },
  };
}

export function deactivate() {
  fetcher = undefined;
  log = undefined;
}
