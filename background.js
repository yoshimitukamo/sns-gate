'use strict';

const SNS_HOSTS = new Set([
  'x.com', 'www.x.com',
  'twitter.com', 'www.twitter.com',
  'facebook.com', 'www.facebook.com',
]);

// メモリ内バイパス管理 (site -> 有効期限 timestamp)
const bypasses = {};
const BYPASS_MS = 3 * 60 * 1000; // ゲート通過後3分間は再チェックなし

// ── ナビゲーション横取り ──
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // メインフレームのみ

  let hostname;
  try { hostname = new URL(details.url).hostname.toLowerCase(); }
  catch { return; }

  if (!SNS_HOSTS.has(hostname)) return;

  const site = hostname.replace(/^www\./, '');
  const now = Date.now();

  // バイパス有効期間中 → ゲートなしで通過
  if (bypasses[site] && bypasses[site] > now) return;

  // ゲートページへリダイレクト（元URLを保持）
  const gateUrl = chrome.runtime.getURL('gate.html')
    + `?site=${encodeURIComponent(site)}`
    + `&to=${encodeURIComponent(details.url)}`;

  chrome.tabs.update(details.tabId, { url: gateUrl });
});

// ── ゲートから「開く」を受信 → バイパスをセット ──
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.action === 'allow') {
    bypasses[msg.site] = Date.now() + BYPASS_MS;
    respond({ ok: true });
  }
  return true; // 非同期レスポンスを許可
});
