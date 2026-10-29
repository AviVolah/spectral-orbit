// Standard MIDI File, format 0. Preserves detected note times, not score quantization.
// Users can import the result into a DAW or notation editor to correct model mistakes.
const PPQ = 480;

function be16(value) {
  return [(value >>> 8) & 255, value & 255];
}

function be32(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255,
    (value >>> 8) & 255, value & 255];
}

function vlq(value) {
  let number = Math.min(0x0fffffff, Math.max(0, Math.floor(value)));
  const bytes = [number & 127];
  while ((number >>>= 7) > 0) bytes.unshift((number & 127) | 128);
  return bytes;
}

export function exportMidi(notes, bpm = 120, beatsPerBar = 4) {
  const tempo = Number.isFinite(Number(bpm))
    ? Math.max(40, Math.min(240, Number(bpm))) : 120;
  const meter = Number(beatsPerBar) === 3 ? 3 : 4;
  const microsecondsPerQuarter = Math.round(60000000 / tempo);
  const ticksPerSecond = PPQ * tempo / 60;
  const events = [
    { tick: 0, order: -2, data: [
      0xff, 0x51, 0x03, (microsecondsPerQuarter >>> 16) & 255,
      (microsecondsPerQuarter >>> 8) & 255, microsecondsPerQuarter & 255,
    ] },
    { tick: 0, order: -1, data: [0xff, 0x58, 0x04, meter, 2, 24, 8] },
  ];

  for (const note of Array.isArray(notes) ? notes : []) {
    if (!Number.isFinite(note.pitchMidi) ||
        !Number.isFinite(note.startTimeSeconds) ||
        !Number.isFinite(note.durationSeconds) ||
        note.startTimeSeconds < 0 || note.durationSeconds <= 0) continue;
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitchMidi)));
    const start = Math.max(0, Math.round(note.startTimeSeconds * ticksPerSecond));
    const end = Math.max(start + 1,
      Math.round((note.startTimeSeconds + note.durationSeconds) * ticksPerSecond));
    events.push({ tick: start, order: 1, data: [0x90, pitch, 86] });
    events.push({ tick: end, order: 0, data: [0x80, pitch, 0] });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  let previousTick = 0;
  for (const event of events) {
    track.push(...vlq(event.tick - previousTick), ...event.data);
    previousTick = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0); // end-of-track at last note-off

  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, ...be32(6), ...be16(0), ...be16(1), ...be16(PPQ),
    0x4d, 0x54, 0x72, 0x6b, ...be32(track.length), ...track,
  ]);
}
