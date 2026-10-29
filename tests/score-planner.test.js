import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBpm, planScore } from '../src/score-planner.js';

const n = (pitchMidi, startTimeSeconds, durationSeconds) => ({
  pitchMidi, startTimeSeconds, durationSeconds,
});
const score = (notes, options = {}) => planScore(notes, { bpm: 120, ...options });
const completeBars = (plan) => {
  for (const bar of plan.bars) {
    for (const voice of bar) {
      assert.equal(voice.reduce((sum, item) => sum + item.ticks, 0), plan.barTicks);
    }
  }
};

test('one second at 120 BPM is a half note with a half rest', () => {
  const plan = score([n(60, 0, 1)]);
  assert.equal(plan.voiceCount, 1);
  assert.deepEqual(plan.bars[0][0].map((e) => [e.kind, e.duration]), [['note', 'h'], ['rest', 'h']]);
  completeBars(plan);
});
test('simultaneous notes with same end become one chord', () => {
  const plan = score([n(60, 0, 1), n(64, 0, 1), n(67, 0, 1)]);
  assert.equal(plan.voiceCount, 1);
  assert.deepEqual(plan.bars[0][0][0].pitches, [60, 64, 67]);
  completeBars(plan);
});
test('overlapping notes of different onsets remain in distinct voices', () => {
  const plan = score([n(60, 0, 2), n(64, 0.5, 1)]);
  assert.equal(plan.voiceCount, 2);
  assert.equal(plan.bars[0][0].filter(e => e.kind === 'note').length, 1);
  assert.equal(plan.bars[0][1].filter(e => e.kind === 'note').length, 1);
  completeBars(plan);
});
test('sustained note across barline is split and tied', () => {
  const plan = score([n(67, 1.5, 2)]);
  assert.equal(plan.bars.length, 2);
  const first = plan.bars[0][0].filter(e => e.kind === 'note');
  const second = plan.bars[1][0].filter(e => e.kind === 'note');
  assert.equal(first.at(-1).tieToNext, true);
  assert.equal(second[0].tieFromPrevious, true);
  completeBars(plan);
});
test('three-quarter bars fill precisely, including rests', () => {
  const plan = score([n(60, 0.5, 0.5), n(65, 2, 0.5)], {beatsPerBar: 3});
  assert.equal(plan.barTicks, 12);
  completeBars(plan);
});
test('short note, duplicate note and invalid inputs are safe', () => {
  const plan = score([n(60, 0, 0.01), n(60, 0, 0.01), n(999, 0, 1), n(72, -1, 1)]);
  assert.equal(plan.voiceCount, 1);
  assert.equal(plan.bars[0][0][0].ticks, 1);
  assert.equal(plan.bars[0][0][0].pitches.length, 1);
  completeBars(plan);
});
test('long recordings truncate with a warning, not hidden corruption', () => {
  const plan = score([n(60, 0, 100)], {maxBars: 2});
  assert.equal(plan.bars.length, 2);
  assert.ok(plan.warnings.length);
  completeBars(plan);
});
test('estimator has a deterministic fallback', () => {
  assert.equal(estimateBpm([]), 120);
  assert.ok(estimateBpm([n(60,0,0.5), n(62,0.5,0.5), n(64,1,0.5)]) >= 60);
});
