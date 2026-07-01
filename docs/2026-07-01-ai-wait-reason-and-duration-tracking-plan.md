# AI待ち理由追加 + 滞在時間トラッキング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SNS Gate 拡張に「AI待ち」理由ボタンを追加し、タブフォーカス推定によるSNS滞在時間トラッキングを実装する。

**Architecture:** 状態遷移ロジック（どのタブをいつから計測するか）を `tracking.js` に純粋関数として切り出し、Node.js組み込みテストランナーでユニットテストする。`background.js` はその純粋関数を呼び出し、Chrome API（`chrome.tabs`, `chrome.windows`, `chrome.storage`）と結線するだけの薄いグルーコードにする。UI側（`gate.html`/`popup.js`）へのボタン追加は独立した小タスク。

**Tech Stack:** Vanilla JS (ES Modules), Chrome Extension Manifest V3, Node.js組み込み `node:test` / `node:assert`（ビルドツール・外部テストフレームワーク不使用）

## Global Constraints

- 外部サーバーへのデータ送信は一切行わない（README記載の既存方針を維持）
- ビルドステップなし（バンドラー導入禁止、素のESMのまま）
- 新規Chrome拡張権限は追加しない（`tabs` permission は既存のまま使う）
- 参照設計: `docs/2026-07-01-ai-wait-reason-and-duration-tracking-design.md`

---

### Task 1: tracking.js — 純粋な状態遷移ロジック（TDD）

**Files:**
- Create: `tracking.js`
- Create: `tracking.test.js`
- Create: `package.json`

**Interfaces:**
- Produces:
  - `createTrackingState(): { tabSites: Map<number, string>, tracking: {tabId, site, startedAt} | null }`
  - `endCurrentTracking(state, now: number): { state, flush: {site, ms} | null }`
  - `registerAllowedTab(state, tabId: number, site: string, now: number): { state, flush }`
  - `handleTabActivated(state, activatedTabId: number, now: number): { state, flush }`
  - `handleWindowFocusChanged(state, focused: boolean, activeTabId: number|null, now: number): { state, flush }`
  - `handleTabUrlChanged(state, tabId: number, site: string|null, now: number): { state, flush }`
  - `handleTabRemoved(state, tabId: number, now: number): { state, flush }`
  - すべて非破壊（引数の `state` を変更せず新しい `state` を返す）

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "sns-gate",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く（tracking.test.js）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrackingState,
  endCurrentTracking,
  registerAllowedTab,
  handleTabActivated,
  handleWindowFocusChanged,
  handleTabUrlChanged,
  handleTabRemoved,
} from './tracking.js';

test('createTrackingState returns empty state', () => {
  const state = createTrackingState();
  assert.equal(state.tracking, null);
  assert.equal(state.tabSites.size, 0);
});

test('endCurrentTracking with no active tracking returns null flush', () => {
  const state = createTrackingState();
  const { state: next, flush } = endCurrentTracking(state, 1000);
  assert.equal(flush, null);
  assert.equal(next.tracking, null);
});

test('registerAllowedTab starts tracking and registers site', () => {
  const state = createTrackingState();
  const { state: next, flush } = registerAllowedTab(state, 1, 'x.com', 1000);
  assert.equal(flush, null);
  assert.equal(next.tabSites.get(1), 'x.com');
  assert.deepEqual(next.tracking, { tabId: 1, site: 'x.com', startedAt: 1000 });
});

test('registerAllowedTab flushes prior tracking before starting new one', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = registerAllowedTab(state, 2, 'facebook.com', 5000);
  assert.deepEqual(flush, { site: 'x.com', ms: 4000 });
  assert.deepEqual(next.tracking, { tabId: 2, site: 'facebook.com', startedAt: 5000 });
});

test('handleTabActivated switches tracking to newly activated SNS tab', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  state = { ...state, tabSites: new Map(state.tabSites).set(2, 'facebook.com') };
  const { state: next, flush } = handleTabActivated(state, 2, 6000);
  assert.deepEqual(flush, { site: 'x.com', ms: 5000 });
  assert.deepEqual(next.tracking, { tabId: 2, site: 'facebook.com', startedAt: 6000 });
});

test('handleTabActivated to non-SNS tab flushes and stops tracking', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = handleTabActivated(state, 99, 3000);
  assert.deepEqual(flush, { site: 'x.com', ms: 2000 });
  assert.equal(next.tracking, null);
});

test('handleWindowFocusChanged(false) flushes and stops tracking', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = handleWindowFocusChanged(state, false, null, 4000);
  assert.deepEqual(flush, { site: 'x.com', ms: 3000 });
  assert.equal(next.tracking, null);
});

test('handleWindowFocusChanged(true) resumes tracking for active SNS tab', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  ({ state } = handleWindowFocusChanged(state, false, null, 4000));
  const { state: next, flush } = handleWindowFocusChanged(state, true, 1, 7000);
  assert.equal(flush, null);
  assert.deepEqual(next.tracking, { tabId: 1, site: 'x.com', startedAt: 7000 });
});

test('handleTabUrlChanged to non-SNS host removes tab and flushes if tracking', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = handleTabUrlChanged(state, 1, null, 2500);
  assert.deepEqual(flush, { site: 'x.com', ms: 1500 });
  assert.equal(next.tabSites.has(1), false);
  assert.equal(next.tracking, null);
});

test('handleTabUrlChanged to another SNS host on same tab updates registration without flushing', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = handleTabUrlChanged(state, 1, 'x.com', 2500);
  assert.equal(flush, null);
  assert.equal(next.tabSites.get(1), 'x.com');
});

test('handleTabRemoved flushes tracking and forgets tab', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { state: next, flush } = handleTabRemoved(state, 1, 3200);
  assert.deepEqual(flush, { site: 'x.com', ms: 2200 });
  assert.equal(next.tabSites.has(1), false);
  assert.equal(next.tracking, null);
});

test('flush ms of 0 or negative is not emitted', () => {
  let state = createTrackingState();
  ({ state } = registerAllowedTab(state, 1, 'x.com', 1000));
  const { flush } = endCurrentTracking(state, 1000);
  assert.equal(flush, null);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `cd ~/Projects/sns-gate && npm test`
Expected: FAIL — `tracking.js` が存在しないため `Cannot find module './tracking.js'` エラー

- [ ] **Step 4: tracking.js を実装**

```js
'use strict';

export function createTrackingState() {
  return { tabSites: new Map(), tracking: null };
}

function cloneState(state) {
  return { tabSites: new Map(state.tabSites), tracking: state.tracking };
}

export function endCurrentTracking(state, now) {
  if (!state.tracking) return { state, flush: null };
  const { site, startedAt } = state.tracking;
  const ms = now - startedAt;
  const next = cloneState(state);
  next.tracking = null;
  return { state: next, flush: ms > 0 ? { site, ms } : null };
}

export function registerAllowedTab(state, tabId, site, now) {
  const { state: afterEnd, flush } = endCurrentTracking(state, now);
  const next = cloneState(afterEnd);
  next.tabSites.set(tabId, site);
  next.tracking = { tabId, site, startedAt: now };
  return { state: next, flush };
}

export function handleTabActivated(state, activatedTabId, now) {
  const { state: afterEnd, flush } = endCurrentTracking(state, now);
  const site = afterEnd.tabSites.get(activatedTabId);
  if (!site) return { state: afterEnd, flush };
  const next = cloneState(afterEnd);
  next.tracking = { tabId: activatedTabId, site, startedAt: now };
  return { state: next, flush };
}

export function handleWindowFocusChanged(state, focused, activeTabId, now) {
  const { state: afterEnd, flush } = endCurrentTracking(state, now);
  if (!focused) return { state: afterEnd, flush };
  const site = afterEnd.tabSites.get(activeTabId);
  if (!site) return { state: afterEnd, flush };
  const next = cloneState(afterEnd);
  next.tracking = { tabId: activeTabId, site, startedAt: now };
  return { state: next, flush };
}

export function handleTabUrlChanged(state, tabId, site, now) {
  const isTracking = !!(state.tracking && state.tracking.tabId === tabId);
  const { state: afterEnd, flush } = isTracking
    ? endCurrentTracking(state, now)
    : { state, flush: null };
  const next = cloneState(afterEnd);
  if (site) {
    next.tabSites.set(tabId, site);
  } else {
    next.tabSites.delete(tabId);
  }
  return { state: next, flush };
}

export function handleTabRemoved(state, tabId, now) {
  const isTracking = !!(state.tracking && state.tracking.tabId === tabId);
  const { state: afterEnd, flush } = isTracking
    ? endCurrentTracking(state, now)
    : { state, flush: null };
  const next = cloneState(afterEnd);
  next.tabSites.delete(tabId);
  return { state: next, flush };
}
```

- [ ] **Step 5: テストを実行してパスを確認**

Run: `cd ~/Projects/sns-gate && npm test`
Expected: PASS — 全12テストが緑

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/sns-gate
git add package.json tracking.js tracking.test.js
git commit -m "feat: タブフォーカス推定の滞在時間トラッキング用ロジックを追加"
```

---

### Task 2: background.js — Chrome APIとの結線

**Files:**
- Modify: `background.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: Task 1 の `tracking.js` の全エクスポート関数
- Produces: `chrome.storage.local` の `dur:{site}:{date}` キーへの加算（popup.js が既に読んでいる形式）

- [ ] **Step 1: manifest.json の background に `"type": "module"` を追加**

`manifest.json` の `background` セクションを以下に変更:

```json
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
```

- [ ] **Step 2: background.js を書き換え**

既存の内容（`SNS_HOSTS`, `bypasses`, `onBeforeNavigate` リスナー）はそのまま残し、以下を追加・変更する。ファイル全体を以下に置き換える:

```js
'use strict';

import {
  createTrackingState,
  registerAllowedTab,
  handleTabActivated,
  handleWindowFocusChanged,
  handleTabUrlChanged,
  handleTabRemoved,
} from './tracking.js';

const SNS_HOSTS = new Set([
  'x.com', 'www.x.com',
  'twitter.com', 'www.twitter.com',
  'facebook.com', 'www.facebook.com',
]);
const SNS_HOSTS_BARE = new Set(['x.com', 'twitter.com', 'facebook.com']);

// メモリ内バイパス管理 (site -> 有効期限 timestamp)
const bypasses = {};
const BYPASS_MS = 3 * 60 * 1000; // ゲート通過後3分間は再チェックなし

// ── 滞在時間トラッキング状態 ──
let trackingState = createTrackingState();

function flushDuration(flush) {
  if (!flush) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const key = `dur:${flush.site}:${dateStr}`;
  chrome.storage.local.get([key], (data) => {
    const current = data[key] || 0;
    chrome.storage.local.set({ [key]: current + flush.ms });
  });
}

function bareHost(hostname) {
  return hostname.replace(/^www\./, '');
}

// ── ナビゲーション横取り ──
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // メインフレームのみ

  let hostname;
  try { hostname = new URL(details.url).hostname.toLowerCase(); }
  catch { return; }

  if (!SNS_HOSTS.has(hostname)) return;

  const site = bareHost(hostname);
  const now = Date.now();

  // バイパス有効期間中 → ゲートなしで通過
  if (bypasses[site] && bypasses[site] > now) return;

  // ゲートページへリダイレクト（元URLを保持）
  const gateUrl = chrome.runtime.getURL('gate.html')
    + `?site=${encodeURIComponent(site)}`
    + `&to=${encodeURIComponent(details.url)}`;

  chrome.tabs.update(details.tabId, { url: gateUrl });
});

// ── ゲートから「開く」を受信 → バイパスをセット + 滞在時間トラッキング開始 ──
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === 'allow') {
    bypasses[msg.site] = Date.now() + BYPASS_MS;

    if (sender.tab && sender.tab.id != null) {
      const { state, flush } = registerAllowedTab(trackingState, sender.tab.id, msg.site, Date.now());
      trackingState = state;
      flushDuration(flush);
    }

    respond({ ok: true });
  }
  return true; // 非同期レスポンスを許可
});

// ── タブ切り替え ──
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const { state, flush } = handleTabActivated(trackingState, tabId, Date.now());
  trackingState = state;
  flushDuration(flush);
});

// ── ウィンドウのフォーカス切り替え ──
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const { state, flush } = handleWindowFocusChanged(trackingState, false, null, Date.now());
    trackingState = state;
    flushDuration(flush);
    return;
  }
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    const activeTabId = tabs[0] && tabs[0].id;
    const { state, flush } = handleWindowFocusChanged(trackingState, true, activeTabId, Date.now());
    trackingState = state;
    flushDuration(flush);
  });
});

// ── タブ内でのURL変化（SNS内遷移 or 離脱）──
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  let hostname;
  try { hostname = new URL(changeInfo.url).hostname.toLowerCase(); }
  catch { return; }
  const bare = bareHost(hostname);
  const site = SNS_HOSTS_BARE.has(bare) ? bare : null;

  const { state, flush } = handleTabUrlChanged(trackingState, tabId, site, Date.now());
  trackingState = state;
  flushDuration(flush);
});

// ── タブが閉じられた ──
chrome.tabs.onRemoved.addListener((tabId) => {
  const { state, flush } = handleTabRemoved(trackingState, tabId, Date.now());
  trackingState = state;
  flushDuration(flush);
});
```

- [ ] **Step 3: Chrome拡張として動作確認**

1. `chrome://extensions/` を開き、SNS Gate を「再読み込み」
2. `x.com` を開く → ゲート表示 → 適当な理由を選んで「この理由で開く」
3. 別タブに切り替えて10秒待ち、再び x.com タブに戻る
4. 拡張アイコンをクリックし popup を開く → 「滞在時間」が "—" ではなく実測値（例: 10s 未満なら "—" のまま、10秒以上待てば分表記）になっているか確認
5. Chrome DevTools で service worker のコンソールにエラーが出ていないか確認（`chrome://extensions/` → SNS Gate → 「Service Worker」リンク）

Expected: エラーなし。タブ切り替え後、滞在時間が加算されている。

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/sns-gate
git add background.js manifest.json
git commit -m "feat: background.js にタブフォーカス滞在時間トラッキングを結線"
```

---

### Task 3: 「AI待ち」理由ボタンの追加

**Files:**
- Modify: `gate.html`
- Modify: `popup.js`

**Interfaces:**
- Consumes: なし（UIのみの変更）
- Produces: `log` エントリの `reason` フィールドに新しい値 `'ai_wait'` が入り得るようになる

- [ ] **Step 1: gate.html にボタンを追加**

`gate.html` の `.options` 内、`habit` ボタンの直前に追加:

```html
      <button class="opt opt-honest" data-key="ai_wait">AIの返信待ちでつい（正直に言うと）</button>
```

（結果として `.options` は `dm` → `research` → `post` → `social` → `break` → `ai_wait` → `habit` の順になる）

- [ ] **Step 2: popup.js の REASON_SHORT にエントリを追加**

`popup.js` の `REASON_SHORT` オブジェクトに追加:

```js
const REASON_SHORT = {
  dm:       'DM・返信',
  research: '情報収集',
  post:     '投稿',
  social:   '近況確認',
  break:    '休憩',
  ai_wait:  '🤖 AI待ち',
  habit:    '😶 惰性',
};
```

- [ ] **Step 3: ブラウザで動作確認**

1. `chrome://extensions/` で SNS Gate を再読み込み
2. `x.com` を開いてゲート画面を表示し、新しい「AIの返信待ちでつい」ボタンが `habit` ボタンの直前・同じ琥珀色スタイルで表示されているか確認
3. そのボタンを選んで「この理由で開く」→ 正常に x.com へ遷移するか確認
4. 拡張アイコンの popup を開き、「今日」タブの理由内訳に「🤖 AI待ち」が棒グラフとして表示されているか確認

Expected: 見た目は `habit` ボタンと同系統（琥珀色）。popup の理由内訳に反映される。

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/sns-gate
git add gate.html popup.js
git commit -m "feat: 「AIの返信待ちでつい」理由ボタンを追加"
```

---

### Task 4: README更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 機能一覧に滞在時間トラッキングの実態を反映**

`README.md` の「データについて」直前、「機能」セクション末尾に以下を追記（既存の「訪問回数・滞在時間・理由をローカル保存して可視化」の一文はそのまま活かし、滞在時間の計測方式について一文加える）:

```markdown
- 滞在時間はタブがアクティブ・フォーカスされている時間から推定します（バックグラウンドタブの時間は含みません）
```

- [ ] **Step 2: Commit**

```bash
cd ~/Projects/sns-gate
git add README.md
git commit -m "docs: 滞在時間トラッキングの計測方式をREADMEに追記"
```
