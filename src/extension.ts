import type * as vscode from 'vscode';
import type MarkdownIt from 'markdown-it';
import { permalinksPlugin } from './markdownItPlugin';

export function activate(_context: vscode.ExtensionContext) {
  return {
    extendMarkdownIt(md: MarkdownIt) {
      return md.use(permalinksPlugin);
    },
  };
}

export function deactivate() {}
