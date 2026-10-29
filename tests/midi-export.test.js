import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMidi } from '../src/midi-export.js';

test('exports a MIDI format-0 file with one track and correct length', () => {
  const bytes = exportMidi([{pitchMidi:60,startTimeSeconds:0,durationSeconds:0.5}],120);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)), 'MThd');
  assert.equal(new TextDecoder().decode(bytes.slice(14,18)), 'MTrk');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(8), 0);
  assert.equal(view.getUint16(10), 1);
  assert.equal(view.getUint16(12), 480);
  assert.equal(view.getUint32(18), bytes.length - 22);
  assert.deepEqual([...bytes.slice(-4)], [0, 255, 47, 0]);
});
test('contains MIDI note-on and note-off for detected pitches', () => {
  const bytes = [...exportMidi([{pitchMidi:64,startTimeSeconds:0,durationSeconds:1}],120)];
  assert.ok(bytes.some((b,i) => b===0x90 && bytes[i+1]===64 && bytes[i+2]===86));
  assert.ok(bytes.some((b,i) => b===0x80 && bytes[i+1]===64 && bytes[i+2]===0));
});
test('skips invalid notes and supports 3/4 time', () => {
  const bytes = [...exportMidi([{pitchMidi:88,startTimeSeconds:-1,durationSeconds:1}],90,3)];
  assert.ok(bytes.some((b,i) => b===0xff && bytes[i+1]===0x58 && bytes[i+3]===3));
  assert.equal(bytes.filter(b=>b===0x90).length, 0);
});
