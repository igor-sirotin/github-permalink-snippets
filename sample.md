# Sample: GitHub Permalinks in Markdown Preview

When you paste a GitHub permalink on its own line, this extension renders the
linked code as an inline snippet card — just like GitHub does in PR comments.

## Single line

https://github.com/igor-sirotin/github-permalink-snippets/blob/064d4c8eba2e3cb11b2bc0223582b490fdcc74b6/src/extension.ts#L71

## Range of lines

https://github.com/igor-sirotin/github-permalink-snippets/blob/064d4c8eba2e3cb11b2bc0223582b490fdcc74b6/src/extension.ts#L71-L74

## Padded List Item

- Padded list item:

  https://github.com/igor-sirotin/github-permalink-snippets/blob/064d4c8eba2e3cb11b2bc0223582b490fdcc74b6/src/extension.ts#L71


## Private repo link

This repo is private, so the snippet will show a friendly load error — that
itself demonstrates the fallback path:

https://github.com/igor-sirotin/private-repo-demo/blob/8082cd67dc9e1aeedee2e016bf0d70bd60aa6506/README.md?plain=1#L1-L2

## Inline links are left alone

A regular [inline link](https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L26)
inside a sentence is **not** transformed — only bare URLs on their own paragraph.

## Non-permalink GitHub URLs are left alone

https://github.com/microsoft/vscode
