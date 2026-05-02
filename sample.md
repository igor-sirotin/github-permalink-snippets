# Sample: GitHub Permalinks in Markdown Preview

When you paste a GitHub permalink on its own line, this extension renders the
linked code as an inline snippet card — just like GitHub does in PR comments.

## Single line

https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L26

https://github.com/logos-messaging/logos-delivery/blob/75864a705ea0b913d517a5f3640747f8709e9e53/Dockerfile#L16
https://github.com/logos-messaging/logos-delivery/blob/75864a705ea0b913d517a5f3640747f8709e9e53/Dockerfile#L17 https://github.com/logos-messaging/logos-delivery/blob/75864a705ea0b913d517a5f3640747f8709e9e53/Dockerfile#L18

## Range of lines

https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L20-L35

## The original example from the task

This repo is private, so the snippet will show a friendly load error — that
itself demonstrates the fallback path:

https://github.com/logos-messaging/logos-delivery/blob/cbb12b8e050895d456f516863342057d2169a2d9/waku/api/api.nim#L16

## Inline links are left alone

A regular [inline link](https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L26)
inside a sentence is **not** transformed — only bare URLs on their own paragraph.

## Non-permalink GitHub URLs are left alone

https://github.com/microsoft/vscode
