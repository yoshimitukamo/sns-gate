'use strict';

const params  = new URLSearchParams(location.search);
const site    = params.get('site') || '';
const destUrl = params.get('to')   || `https://${site}`;

document.getElementById('site-label').textContent = site;

let selected = null;
const goBtn   = document.getElementById('go');
const backBtn = document.getElementById('back');

document.querySelectorAll('.opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.opt').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    selected = btn.dataset.key;
    goBtn.classList.add('show');
  });
});

goBtn.addEventListener('click', () => {
  if (!selected) return;
  goBtn.disabled = true;

  // 1. 訪問を記録
  const today = new Date().toISOString().slice(0, 10);
  const key   = `${site}:${today}`;
  chrome.storage.local.get(['visits', 'log'], (data) => {
    const visits = data.visits || {};
    const log    = data.log    || [];
    visits[key] = (visits[key] || 0) + 1;
    log.push({ ts: Date.now(), site, reason: selected });
    chrome.storage.local.set({ visits, log });
  });

  // 2. background に「バイパスを許可」を伝え、完了後に遷移
  chrome.runtime.sendMessage({ action: 'allow', site }, () => {
    // 滞在時間トラッキングは遷移先ページでは計測できない（別ドメイン）
    // gate ページ自体から departure 時刻は不明なのでここでは記録しない
    location.href = destUrl;
  });
});

backBtn.addEventListener('click', () => {
  location.href = 'https://www.google.com';
});
