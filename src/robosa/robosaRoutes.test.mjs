import test from 'node:test';
import assert from 'node:assert/strict';
import { isReservedHandle } from '../../server/providers/robosa/paths.js';
import { resolveRobosaPath } from '../../server/providers/robosa/routes.js';

test('Robosa routes reserve app and asset paths', () => {
  assert.equal(resolveRobosaPath('/'), 'studio');
  assert.equal(resolveRobosaPath('/api'), null);
  assert.equal(resolveRobosaPath('/src'), null);
  assert.equal(resolveRobosaPath('/logo.svg'), null);
});

test('Robosa routes support studio and public handles', () => {
  assert.equal(resolveRobosaPath('/studio'), 'studio');
  assert.equal(resolveRobosaPath('/robosa/'), 'studio');
  assert.equal(resolveRobosaPath('/nazmul'), 'profile');
  assert.equal(resolveRobosaPath('/nazmul-hossain'), 'profile');
});

test('application routes cannot be claimed as public handles', () => {
  assert.equal(isReservedHandle('api'), true);
  assert.equal(isReservedHandle('studio'), true);
  assert.equal(isReservedHandle('robosa'), true);
  assert.equal(isReservedHandle('nazmul'), false);
});
