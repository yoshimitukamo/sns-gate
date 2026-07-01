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
  const currentSite = state.tabSites.get(tabId);
  if (site && site === currentSite) {
    // 同一サイト内での遷移 — トラッキングを継続する
    return { state, flush: null };
  }

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
