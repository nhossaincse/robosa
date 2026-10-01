import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAvatarRig,
  canonicalViseme,
  createMorphBinding,
  morphValuesForViseme,
  VISEME_IDS,
  visemeForText,
  vrmValuesForViseme,
} from './avatarRig.js';

test('Oculus morph targets produce a full facial rig report', () => {
  const dictionary = Object.fromEntries(
    VISEME_IDS.map((id, index) => [`viseme_${id}`, index]),
  );
  const binding = createMorphBinding(dictionary);
  const report = analyzeAvatarRig([binding], { skinnedMeshes: 1 });
  assert.equal(report.level, 'full');
  assert.equal(report.oculusCount, 14);
  assert.equal(report.skinnedMeshes, 1);
});

test('VRM expressions are recognized without relying on morph target names', () => {
  const report = analyzeAvatarRig([], {
    vrmExpressions: ['aa', 'ih', 'ou', 'ee', 'oh', 'blink'],
  });
  assert.equal(report.level, 'vrm');
  assert.equal(report.hasVrmMouth, true);
});

test('ARKit jaw targets provide a basic fallback', () => {
  const binding = createMorphBinding({ jawOpen: 2, mouthPucker: 4 });
  const values = morphValuesForViseme(binding, 'U', 0.8);
  assert.equal(analyzeAvatarRig([binding]).level, 'basic');
  assert.equal(values.get(4), 0.68);
  assert.ok(values.get(2) > 0);
});

test('text timing maps speech groups to Oculus visemes', () => {
  assert.equal(visemeForText('this', 0), 'TH');
  assert.equal(visemeForText('ship', 0), 'CH');
  assert.equal(visemeForText('robot', 0), 'RR');
  assert.equal(canonicalViseme('viseme_PP'), 'PP');
  assert.equal(canonicalViseme('rest'), 'sil');
  assert.deepEqual(vrmValuesForViseme('O', 0.75), {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0.75,
  });
});
