// Pure transcription-to-notation planning. No model or browser dependencies.
// Times are quantized to a sixteenth-note grid, then split into exact bar lengths.
const NOTE_LENGTHS = [
  { ticks: 16, duration: 'w' },
  { ticks: 12, duration: 'hd' },
  { ticks: 8, duration: 'h' },
  { ticks: 6, duration: 'qd' },
  { ticks: 4, duration: 'q' },
  { ticks: 3, duration: '8d' },
  { ticks: 2, duration: '8' },
  { ticks: 1, duration: '16' },
];

export function estimateBpm(notes) {
  const onsets = [...new Set(notes
    .filter((n) => Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds >= 0)
    .map((n) => Math.round(n.startTimeSeconds * 1000) / 1000))]
    .sort((a, b) => a - b);

  if (onsets.length < 3) return 120;

  // Align multiple onsets to an eighth-note pulse. This is an estimate,
  // never a reliable substitute for user-provided tempo or a beat tracker.
  const origin = onsets[0];
  let bestBpm = 120;
  let bestScore = Infinity;

  for (let candidate = 60; candidate <= 180; candidate += 2) {
    let error = 0;
    for (const onset of onsets.slice(1, 65)) {
      const beat = (onset - origin) * candidate / 60;
      error += Math.abs(beat * 2 - Math.round(beat * 2));
    }
    const score = error / Math.min(onsets.length - 1, 64)
      + Math.abs(candidate - 110) * 0.0007;
    if (score < bestScore) {
      bestScore = score;
      bestBpm = candidate;
    }
  }
  return bestBpm;
}

export function planScore(notes, options = {}) {
  const valid = (Array.isArray(notes) ? notes : []).filter((n) =>
    Number.isFinite(n.pitchMidi) && n.pitchMidi >= 0 && n.pitchMidi <= 127
    && Number.isFinite(n.startTimeSeconds) && n.startTimeSeconds >= 0
    && Number.isFinite(n.durationSeconds) && n.durationSeconds > 0);
  const requestedBpm = Number(options.bpm);
  const bpm = requestedBpm >= 40 && requestedBpm <= 240
    ? requestedBpm : estimateBpm(valid);
  const beatsPerBar = Number(options.beatsPerBar) === 3 ? 3 : 4;
  const barTicks = beatsPerBar * 4;
  const secondsToTicks = bpm * 4 / 60;
  const maxBars = Math.max(1, Math.min(128, Number(options.maxBars) || 64));
  const warnings = [];
  const grouped = new Map();

  for (const note of valid) {
    const start = Math.max(0, Math.round(note.startTimeSeconds * secondsToTicks));
    const end = start + Math.max(1, Math.round(note.durationSeconds * secondsToTicks));
    const key = [start, end].join(':');
    if (!grouped.has(key)) grouped.set(key, { start, end, pitches: new Set() });
    grouped.get(key).pitches.add(Math.round(note.pitchMidi));
  }

  const groups = [...grouped.values()]
    .map((group, index) => ({ ...group, id: index, pitches: [...group.pitches].sort((a, b) => a - b) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // Interval partitioning retains overlapping notes instead of flattening
  // them into a misleading single sequential VexFlow voice.
  const voices = [];
  for (const group of groups) {
    let voice = voices.find((candidate) => candidate.end <= group.start);
    if (!voice) {
      voice = { end: 0, groups: [], pitches: [] };
      voices.push(voice);
    }
    voice.groups.push(group);
    voice.pitches.push(...group.pitches);
    voice.end = group.end;
  }

  const lastTick = Math.max(0, ...groups.map((group) => group.end));
  const requiredBars = Math.max(1, Math.ceil(lastTick / barTicks));
  const barCount = Math.min(maxBars, requiredBars);
  const totalTicks = barCount * barTicks;
  if (requiredBars > barCount) {
    warnings.push('Score preview truncated to ' + barCount + ' measures. Use a shorter recording.');
  }
  if (voices.length > 4) {
    warnings.push('Dense polyphony detected; overlapping lines are displayed as separate voices.');
  }

  const activeVoices = voices.length || 1;
  const bars = Array.from({ length: barCount },
    () => Array.from({ length: activeVoices }, () => []));
  const voiceClefs = Array.from({ length: activeVoices }, (_, i) => {
    const pitches = voices[i]?.pitches || [];
    const sorted = [...pitches].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 60;
    return median < 60 ? 'bass' : 'treble';
  });

  function appendSpan(voiceIndex, start, end, group) {
    let cursor = Math.min(start, totalTicks);
    const boundedEnd = Math.min(end, totalTicks);
    while (cursor < boundedEnd) {
      const barIndex = Math.floor(cursor / barTicks);
      const remainingInBar = (barIndex + 1) * barTicks - cursor;
      let remaining = Math.min(boundedEnd - cursor, remainingInBar);
      while (remaining > 0) {
        const length = NOTE_LENGTHS.find((candidate) => candidate.ticks <= remaining);
        bars[barIndex][voiceIndex].push({
          kind: group ? 'note' : 'rest',
          pitches: group ? group.pitches : [],
          groupId: group ? group.id : null,
          startTick: cursor,
          ticks: length.ticks,
          duration: length.duration,
          tieFromPrevious: false,
          tieToNext: false,
        });
        cursor += length.ticks;
        remaining -= length.ticks;
      }
    }
  }

  voices.forEach((voice, voiceIndex) => {
    let cursor = 0;
    for (const group of voice.groups) {
      if (group.start >= totalTicks) break;
      if (group.start > cursor) appendSpan(voiceIndex, cursor, group.start, null);
      appendSpan(voiceIndex, group.start, group.end, group);
      cursor = group.end;
    }
    if (cursor < totalTicks) appendSpan(voiceIndex, cursor, totalTicks, null);
  });
  if (!voices.length) appendSpan(0, 0, totalTicks, null);

  // Consecutive fragments from one note/chord need ties, including across bars.
  for (let voiceIndex = 0; voiceIndex < activeVoices; voiceIndex++) {
    let previous = null;
    for (const bar of bars) {
      for (const item of bar[voiceIndex]) {
        if (previous && item.kind === 'note' && previous.kind === 'note'
            && previous.groupId === item.groupId) {
          previous.tieToNext = true;
          item.tieFromPrevious = true;
        }
        previous = item;
      }
    }
  }

  return {
    bpm, tempoWasEstimated: !(requestedBpm >= 40 && requestedBpm <= 240),
    beatsPerBar, barTicks, bars, voiceCount: activeVoices, voiceClefs,
    noteCount: valid.length, warnings,
  };
}
