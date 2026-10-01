import test from 'node:test';
import assert from 'node:assert/strict';
import { answerTwin, suggestedQuestions } from './twinBrain.js';
import {
  DEFAULT_PROFILE,
  normalizeHandle,
  parseProjects,
} from './profileStore.js';

test('handle normalization produces share-safe paths', () => {
  assert.equal(normalizeHandle('  Nazmul Hossain  '), 'nazmul-hossain');
  assert.equal(normalizeHandle('N@zmul---AI'), 'n-zmul-ai');
});

test('project lines preserve names and descriptions', () => {
  assert.deepEqual(parseProjects('Robosa: A digital twin\nAnother project'), [
    { name: 'Robosa', summary: 'A digital twin' },
    { name: 'Another project', summary: '' },
  ]);
});

test('booking questions return a structured booking action', () => {
  const answer = answerTwin(DEFAULT_PROFILE, 'Can we meet next week?');
  assert.equal(answer.action, 'booking');
  assert.match(answer.text, /request a conversation/i);
});

test('project questions answer from owner-controlled profile data', () => {
  const answer = answerTwin(DEFAULT_PROFILE, 'Tell me about Robosa.me');
  assert.equal(answer.action, null);
  assert.match(answer.text, /owner-controlled digital twin/i);
});

test('unknown questions do not invent an answer', () => {
  const answer = answerTwin(
    DEFAULT_PROFILE,
    'What is your favorite restaurant?',
  );
  assert.match(answer.text, /do not have an approved answer/i);
  assert.equal(suggestedQuestions(DEFAULT_PROFILE).length, 3);
});
