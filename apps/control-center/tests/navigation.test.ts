import assert from 'node:assert/strict';
import test from 'node:test';
import { isNavigationItemActive, navigationItems } from '../lib/navigation.ts';

test('defines each planned control-center module exactly once', () => {
  assert.deepEqual(navigationItems.map(({ href }) => href), ['/operations', '/source-vault', '/planning', '/workflows', '/verification', '/workforce', '/governance', '/learning', '/memory', '/audit']);
  assert.equal(new Set(navigationItems.map(({ href }) => href)).size, navigationItems.length);
});

test('marks a module and its nested routes active without matching sibling prefixes', () => {
  assert.equal(isNavigationItemActive('/source-vault', '/source-vault'), true);
  assert.equal(isNavigationItemActive('/source-vault/items/123', '/source-vault'), true);
  assert.equal(isNavigationItemActive('/source-vault-copy', '/source-vault'), false);
  assert.equal(isNavigationItemActive('/operations', '/source-vault'), false);
  assert.equal(isNavigationItemActive('/planning/drafts/123', '/planning'), true);
  assert.equal(isNavigationItemActive('/verification/runs/123', '/verification'), true);
  assert.equal(isNavigationItemActive('/governance/reviews/123', '/governance'), true);
  assert.equal(isNavigationItemActive('/learning/experiences/123', '/learning'), true);
  assert.equal(isNavigationItemActive('/memory/entries/123', '/memory'), true);
  assert.equal(isNavigationItemActive('/audit/events/123', '/audit'), true);
});
