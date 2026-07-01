# AI待ち理由の追加 + 滞在時間トラッキング実装（設計）

## 背景

- 「AIの応答待ち時間についSNSを開いてしまう」という理由が既存の6択にない
- popup.js は `dur:{site}:{date}` キーから滞在時間を読んで表示しようとしているが、
  このキーへの書き込み処理がどこにも存在せず、常に "—" 表示になっている
  （gate.js に「別ドメインなので計測できない」というコメントが残っているのみ）

## 変更1: 新しい理由ボタン「AI待ち」

- gate.html の options に `opt-honest` 系のボタンをもう1つ追加
  - キー: `ai_wait`
  - ラベル: 「AIの返信待ちでつい（正直に言うと）」
  - 既存の `habit` ボタンと同じ見た目（琥珀色、正直系）
- popup.js の `REASON_SHORT` に `ai_wait: '🤖 AI待ち'` を追加
  - グラフ集計は `entry.reason` をそのままキーにして回しているため、他のロジック変更は不要

## 変更2: 滞在時間トラッキング（タブフォーカス推定方式）

content script は使わず、background.js（service worker）だけでタブのフォーカス時間を推定する。

### 状態

- `tabSites: Map<tabId, site>` — SNSタブとして認識したタブの一覧
- `tracking: { tabId, site, startedAt } | null` — 現在計測中の区間

### 登録タイミング

- gate.js が `allow` メッセージを送る際、background 側で `sender.tab.id` を site とともに `tabSites` に登録する

### 区間の開始/終了トリガー

- `chrome.tabs.onActivated` — アクティブタブが切り替わったら、直前の区間を終了し、新しいタブが `tabSites` にあれば開始
- `chrome.windows.onFocusChanged` — ブラウザウィンドウ自体のフォーカスが外れたら（`WINDOW_ID_NONE`）区間を終了。フォーカスが戻ったら該当ウィンドウの現在アクティブタブを見て再開判定
- `chrome.tabs.onUpdated` — 同じタブ内でSNS以外のURLに遷移したら `tabSites` から削除し、計測中ならそこで終了
- `chrome.tabs.onRemoved` — タブが閉じられたら計測中ならそこで終了し、`tabSites` からも削除

### 加算処理

- 区間終了時、`Date.now() - startedAt` を `dur:{site}:{today}` に加算して `chrome.storage.local` に保存
- popup.js 側の読み込みロジックは変更不要（既存の `dur:` プレフィックス集計をそのまま使う）

### 割り切り事項（明示的にスコープ外）

- 同一SNSサイトを複数タブで同時に開いている場合、アクティブなタブのみ計測する（二重計上はしない設計だが、正確な合算は目指さない）
- 日付をまたいで滞在し続けるケースは稀なため、区間終了時点の日付にまとめて加算する（按分はしない）
- タブが非アクティブになれば計測を止める（バックグラウンド再生中でも「見ている時間」としては計測しない）

## 影響ファイル

- `gate.html` — ボタン追加
- `popup.js` — REASON_SHORT にエントリ追加
- `background.js` — tabSites / tracking 状態管理とイベントハンドラ追加
- `manifest.json` — 変更なし（`tabs` permission は既にあり、追加権限不要）
