# Dependency Update Policy

このリポの依存更新 PR（Dependabot 等）を「その場マージ」しないための判定木。
グローバル規約（`~/.claude/CLAUDE.md` §2「依存更新 PR を『その場マージ』しない」）の
リポ固有版。CI 赤や peer 未対応のまま強制通過（バージョン警告の無効化・peer の強制無視）はしない。

## 0. 前提

- Actions は commit SHA ピン留め、npm は `pnpm-lock.yaml` で固定。更新は Dependabot が
  `.github/dependabot.yml` の設定に従って週次で PR を開く。
- 特に **TypeScript と `typescript-eslint` の peer dependency 整合**が壊れやすい
  （TS のメジャーが先行すると ESLint が `Cjs` エラー等で落ちる）。

## 1. 対応範囲を確認する

まず最新版の peer dependency を確認する。

```bash
pnpm view typescript-eslint@latest version
pnpm view typescript-eslint@latest peerDependencies
pnpm view @typescript-eslint/parser@latest peerDependencies
```

出力の TypeScript 範囲に対象メジャーが含まれていることが条件。

```text
typescript: >=... <8.0.0
```

「最新版が出た」だけでは不十分。公式も、サポート外 TypeScript では警告や不具合が
起こり得ると明記している（typescript-eslint の対応バージョン方針を参照）。

## 2. Dependabot PR を作り直す

対応版公開後は、対象 PR に次をコメントするのが簡単。

```text
@dependabot recreate
```

これで最新の依存関係を使って `package.json` と `pnpm-lock.yaml` が再生成される。
再生成後、差分が最低限この組み合わせになっていることを確認する。

```text
typescript             対象メジャー
typescript-eslint      同メジャー対応版
@typescript-eslint/*   同じ対応系列
eslint                 対応範囲内
```

Dependabot が `typescript-eslint` を一緒に更新しない場合は、その PR を close し、
自分のブランチでまとめて更新する方が明確。

## 3. 手動更新する場合

```bash
git checkout main
git pull --ff-only
git checkout -b deps/typescript-toolchain

pnpm up -D \
  typescript@latest \
  typescript-eslint@latest \
  eslint@latest \
  @eslint/js@latest
```

ここで `pnpm-lock.yaml` も更新される。

## 4. ローカルで全ゲートを検証

```bash
pnpm install --frozen-lockfile
pnpm run lint:ox
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
pnpm audit --audit-level moderate
```

特に重要な 3 つ（lint 通過だけでなく、型推論やコンパイラ挙動の変化も確認するため）。

```bash
pnpm run lint
pnpm run typecheck
pnpm test
```

## 5. MCP の最低限 E2E

```bash
pnpm run build
node dist/index.js
```

stdio サーバーなので MCP Inspector も使える。

```bash
pnpm dlx @modelcontextprotocol/inspector node dist/index.js
```

## 6. マージ可能条件

次をすべて満たしたら squash merge 可能。

- `typescript-eslint` の peer dependency が対象 TypeScript メジャーを含む
- `pnpm install --frozen-lockfile` が成功
- ESLint の `Cjs` エラーが再現しない
- lint / typecheck / build / test がすべて成功
- Node.js CI と CodeQL が成功
- 実際の MCP 起動とツール一覧取得が成功

## 判定フロー

```text
新しい TypeScript 公開
        ↓
typescript-eslint の peer 範囲を確認
        ↓
未対応 → PR を保留・close
対応済み → lockfile 再生成
        ↓
lint → typecheck → build → test → MCP E2E
        ↓
全成功なら Squash Merge
```
