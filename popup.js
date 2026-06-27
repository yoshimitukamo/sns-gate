'use strict';

const SITES = ['x.com', 'twitter.com', 'facebook.com'];
const REASON_SHORT = {
  dm:       'DM・返信',
  research: '情報収集',
  post:     '投稿',
  social:   '近況確認',
  break:    '休憩',
  habit:    '😶 惰性',
};

// ── 日付ユーティリティ ──
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function thisWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().slice(0, 10);
}
function thisMonthPrefix() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function inPeriod(dateStr, period) {
  if (period === 'today') return dateStr === todayStr();
  if (period === 'week')  return dateStr >= thisWeekStart();
  if (period === 'month') return dateStr.startsWith(thisMonthPrefix());
  return false;
}

function formatDur(ms) {
  if (!ms || ms < 10000) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

// ── 日付ラベル ──
const dateEl = document.getElementById('date-label');
dateEl.textContent = new Date().toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' });

// ── タブ切り替え ──
let currentPeriod = 'today';
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentPeriod = tab.dataset.period;
    render(currentPeriod);
  });
});

// ── レンダリング ──
function render(period) {
  chrome.storage.local.get(null, (data) => {
    const log    = data.log    || [];
    const visits = data.visits || {};

    // 集計
    const siteStats = {};
    for (const site of SITES) {
      siteStats[site] = { visits: 0, durMs: 0, reasons: {} };
    }

    // 訪問回数 & 理由 (log から)
    for (const entry of log) {
      if (!entry.site || !siteStats[entry.site]) continue;
      const dateStr = new Date(entry.ts).toISOString().slice(0, 10);
      if (!inPeriod(dateStr, period)) continue;
      siteStats[entry.site].visits++;
      const r = entry.reason || 'unknown';
      siteStats[entry.site].reasons[r] = (siteStats[entry.site].reasons[r] || 0) + 1;
    }

    // 滞在時間 (dur:site:date キー)
    for (const key of Object.keys(data)) {
      if (!key.startsWith('dur:')) continue;
      const [, site, dateStr] = key.split(':');
      if (!siteStats[site] || !inPeriod(dateStr, period)) continue;
      siteStats[site].durMs += data[key] || 0;
    }

    // 表示するサイトを絞る（訪問ありのみ）
    const activeSites = SITES.filter(s => siteStats[s].visits > 0);

    const content = document.getElementById('content');
    const summaryEl = document.getElementById('summary');
    const summaryVal = document.getElementById('summary-value');

    if (activeSites.length === 0) {
      const periodLabel = { today: '今日', week: '今週', month: '今月' }[period];
      content.innerHTML = `
        <div class="empty">
          <span class="empty-icon">🛡</span>
          ${periodLabel}はまだ SNS を開いていません
        </div>`;
      summaryEl.style.display = 'none';
      return;
    }

    // サイトブロック生成
    content.innerHTML = activeSites.map(site => {
      const s = siteStats[site];
      const maxReasonCount = Math.max(...Object.values(s.reasons), 1);

      const habitCount = s.reasons['habit'] || 0;
      const reasonsHtml = Object.entries(s.reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([key, cnt]) => {
          const pct = Math.round((cnt / maxReasonCount) * 100);
          const label = REASON_SHORT[key] || key;
          const isHabit = key === 'habit';
          return `
            <div class="reason-row${isHabit ? ' reason-habit' : ''}">
              <span class="reason-label">${label}</span>
              <div class="reason-bar-wrap">
                <div class="reason-bar-fill${isHabit ? ' habit-fill' : ''}" style="width:${pct}%"></div>
              </div>
              <span class="reason-count">${cnt}</span>
            </div>`;
        }).join('');

      return `
        <div class="site-block">
          <div class="site-name">${site}</div>
          <div class="metrics">
            <div class="metric">
              <div class="metric-number">${s.visits}</div>
              <div class="metric-label">回</div>
            </div>
            <div class="metric">
              <div class="metric-number${s.durMs < 10000 ? ' dim' : ''}">${formatDur(s.durMs)}</div>
              <div class="metric-label">滞在時間</div>
            </div>
          </div>
          <div class="reasons">${reasonsHtml}</div>
        </div>`;
    }).join('');

    // 合計
    const totalVisits = activeSites.reduce((s, site) => s + siteStats[site].visits, 0);
    const totalDur    = activeSites.reduce((s, site) => s + siteStats[site].durMs, 0);
    summaryVal.textContent = `${totalVisits}回 · ${formatDur(totalDur)}`;
    summaryEl.style.display = 'flex';
  });
}

render(currentPeriod);
