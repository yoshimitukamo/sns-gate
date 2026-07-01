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
