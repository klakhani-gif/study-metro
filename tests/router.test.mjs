import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_ROUTES,appRoute,routeNeedsAccount} from '../dist/router.js';

test('application routes normalize trailing slashes and reject unknown paths',()=>{
  for(const route of APP_ROUTES)assert.equal(appRoute(`${route}/`),route);
  assert.equal(appRoute('/login'),'/login');
  assert.equal(appRoute('/unknown'),null);
});

test('account-only routes are explicit while guest study routes remain available',()=>{
  assert.equal(routeNeedsAccount('/friends'),true);
  assert.equal(routeNeedsAccount('/profile'),true);
  assert.equal(routeNeedsAccount('/settings'),true);
  assert.equal(routeNeedsAccount('/network'),false);
  assert.equal(routeNeedsAccount('/departures'),false);
  assert.equal(routeNeedsAccount('/recap'),false);
});
