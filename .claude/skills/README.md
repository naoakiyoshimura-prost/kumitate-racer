# Claude Code skills（このリポジトリ用）

Claude Code がこのフォルダの skill を自動で読みます。ゲーム本体のコードには影響しません。

| skill | 用途 | 出典 |
|---|---|---|
| `threejs-debug-profiler` | 描画が出ない等の不具合調査と、スマホ負荷の計測（ドローコール、ポリゴン数、テクスチャ、メモリ） | majidmanzarpour/threejs-game-skills（MIT、2026-09-27版） |
| `threejs-game-ui-designer` | HUD・メニュー・タッチ操作の見直し（文字のはみ出し、タップ領域、セーフエリア） | 同上 |

ライセンス原文: `THIRD_PARTY_LICENSE-threejs-game-skills.txt`

## 元からの変更点
- 外部の有料API（3D・画像生成）を使う skill への誘導文を削除。APIキーをこのPublicリポジトリに置かない方針のため。
- Codex 用の `agents/openai.yaml` は削除。

## 使うときの前提（docs/HANDOFF.md 優先）
- このゲームの目標は横持ちスマホで30fps以上。影とポストエフェクトは入れない。
- 計測で見つけた改善でも、走行計算（`src/car.ts`）と数値（`src/data/tuning.json`）の感触は変えない。
- skill の指示と HANDOFF.md が食い違ったら HANDOFF.md に従う。
