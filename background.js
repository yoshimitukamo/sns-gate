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
