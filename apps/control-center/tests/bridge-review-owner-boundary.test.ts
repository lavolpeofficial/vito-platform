import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('BRIDGE inbox server view requires exact pinned VITO Owner and no privileged data fallback',()=>{
 const page=readFileSync(new URL('../app/(control-center)/bridge/page.tsx',import.meta.url),'utf8');
 assert.ok(page.includes("import {isVitoInteractiveOwner}"));
 assert.ok(page.includes('isVitoInteractiveOwner(session)'));
 assert.ok(page.includes('!ownerAuthorized ?'));
 assert.ok(page.includes('Zugriff gesperrt'));
 assert.ok(page.includes('Datenquelle nicht verbunden'));
 assert.ok(page.includes('Unbekannt'));
 assert.ok(!page.includes('fetch('));
 assert.ok(!page.includes('approve('));
 assert.ok(!page.includes('FormData'));
 assert.ok(!page.includes('use server'));
});
test('BRIDGE sidebar link visibility depends on actual pinned human Owner',()=>{
 const shell=readFileSync(new URL('../components/app-shell.tsx',import.meta.url),'utf8');
 const nav=readFileSync(new URL('../components/shell-navigation.tsx',import.meta.url),'utf8');
 assert.ok(shell.includes('showBridgeReview={isVitoInteractiveOwner(session)}'));
 assert.ok(nav.includes('showBridgeReview ?'));
 assert.ok(nav.includes('href="/bridge"'));
 assert.ok(!nav.includes('showBridgeReview={true}'));
});
