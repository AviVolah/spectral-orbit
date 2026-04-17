import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot } from 'vexflow';

const NOTE_NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const ACCIDENTALS = [null, '#', null, 'b', null, null, '#', null, 'b', null, 'b', null];
const CHORD_WINDOW = 0.05;

const DURATION_TABLE = [
  { maxBeats: 0.375, vex: '16', beats: 0.25 },
  { maxBeats: 0.625, vex: '8', beats: 0.5 },
  { maxBeats: 0.875, vex: '8d', beats: 0.75 },
  { maxBeats: 1.25, vex: 'q', beats: 1 },
  { maxBeats: 1.75, vex: 'qd', beats: 1.5 },
  { maxBeats: 2.5, vex: 'h', beats: 2 },
  { maxBeats: 3.5, vex: 'hd', beats: 3 },
  { maxBeats: Infinity, vex: 'w', beats: 4 },
];

const REST_DURATION_TABLE = [
  { maxBeats: 0.375, vex: '16r', beats: 0.25 },
  { maxBeats: 0.625, vex: '8r', beats: 0.5 },
  { maxBeats: 1.25, vex: 'qr', beats: 1 },
  { maxBeats: 2.5, vex: 'hr', beats: 2 },
  { maxBeats: Infinity, vex: 'wr', beats: 4 },
];

function midiToVexKey(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const index = midi % 12;
  return {
    key: `${NOTE_NAMES[index]}/${octave}`,
    accidental: ACCIDENTALS[index],
  };
}

function quantizeBeats(beats) {
  for (const entry of DURATION_TABLE) {
    if (beats <= entry.maxBeats) {
      return entry;
    }
  }

  return DURATION_TABLE[DURATION_TABLE.length - 1];
}

function quantizeRestBeats(beats) {
  for (const entry of REST_DURATION_TABLE) {
    if (beats <= entry.maxBeats) {
      return entry;
    }
  }

  return REST_DURATION_TABLE[REST_DURATION_TABLE.length - 1];
}

function isDotted(duration) {
  return duration.endsWith('d');
}

function baseDuration(duration) {
  return duration.replace(/d$/, '');
}

function estimateBPM(notes) {
  if (notes.length < 2) {
    return 120;
  }

  const onsets = [...new Set(notes.map((note) => note.startTimeSeconds))].sort((left, right) => left - right);
  if (onsets.length < 2) {
    return 120;
  }

  const gaps = [];
  for (let index = 1; index < onsets.length; index += 1) {
    const gap = onsets[index] - onsets[index - 1];
    if (gap > 0.05 && gap < 4) {
      gaps.push(gap);
    }
  }

  if (gaps.length === 0) {
    return 120;
  }

  gaps.sort((left, right) => left - right);
  const median = gaps[Math.floor(gaps.length / 2)];
  let bpm = 60 / median;

  while (bpm < 50) {
    bpm *= 2;
  }

  while (bpm > 200) {
    bpm /= 2;
  }

  const commonBpms = [60, 72, 80, 84, 90, 96, 100, 108, 112, 120, 126, 132, 140, 144, 152, 160, 176, 192];
  let bestMatch = 120;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const commonBpm of commonBpms) {
    const distance = Math.abs(bpm - commonBpm);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = commonBpm;
    }
  }

  return bestMatch;
}

function groupIntoSlots(notes) {
  const sortedNotes = [...notes].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  const slots = [];

  for (const note of sortedNotes) {
    const lastSlot = slots[slots.length - 1];

    if (lastSlot && Math.abs(note.startTimeSeconds - lastSlot.timeSeconds) < CHORD_WINDOW) {
      lastSlot.pitches.push(Math.round(note.pitchMidi));
      lastSlot.durationSeconds = Math.max(lastSlot.durationSeconds, note.durationSeconds);
      continue;
    }

    slots.push({
      timeSeconds: note.startTimeSeconds,
      durationSeconds: note.durationSeconds,
      pitches: [Math.round(note.pitchMidi)],
    });
  }

  return slots;
}

function buildMeasures(slots, bpm) {
  const beatDuration = 60 / bpm;
  const beatsPerMeasure = 4;
  const events = slots.map((slot) => ({
    beatStart: slot.timeSeconds / beatDuration,
    beatDuration: Math.max(slot.durationSeconds / beatDuration, 0.25),
    pitches: slot.pitches,
  }));

  const measures = [];
  let eventIndex = 0;
  const totalBeats = events.length > 0
    ? events[events.length - 1].beatStart + events[events.length - 1].beatDuration
    : 0;
  const measureCount = Math.max(1, Math.ceil(totalBeats / beatsPerMeasure));

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const measureStart = measureIndex * beatsPerMeasure;
    const measureEnd = measureStart + beatsPerMeasure;
    const items = [];
    let cursor = 0;

    while (eventIndex < events.length && events[eventIndex].beatStart < measureEnd) {
      const event = events[eventIndex];
      const localStart = event.beatStart - measureStart;

      if (localStart > cursor + 0.12) {
        items.push({ type: 'rest', beatDur: localStart - cursor });
        cursor = localStart;
      }

      let noteDuration = event.beatDuration;
      if (cursor + noteDuration > beatsPerMeasure) {
        noteDuration = beatsPerMeasure - cursor;
      }

      items.push({
        type: 'note',
        beatDur: noteDuration,
        pitches: event.pitches,
      });
      cursor += noteDuration;
      eventIndex += 1;
    }

    if (cursor < beatsPerMeasure - 0.12) {
      items.push({ type: 'rest', beatDur: beatsPerMeasure - cursor });
    }

    if (items.length > 0) {
      measures.push(items);
    }
  }

  return measures;
}

export class ScoreRenderer {
  constructor(containerId) {
    this.containerId = containerId;
  }

  render(notes) {
    const container = document.querySelector(this.containerId);
    if (!container) {
      console.error('Score container not found');
      return null;
    }

    container.innerHTML = '';

    if (!notes || notes.length === 0) {
      container.innerHTML = '<p style="color:#999;padding:2rem;">No notes detected. Try a clearer audio source.</p>';
      return null;
    }

    const bpm = estimateBPM(notes);
    const slots = groupIntoSlots(notes);
    const measures = buildMeasures(slots, bpm);

    if (measures.length === 0) {
      container.innerHTML = '<p style="color:#999;padding:2rem;">Could not form any measures.</p>';
      return null;
    }

    const staveWidth = 350;
    const stavesPerRow = Math.max(1, Math.floor((container.clientWidth - 40) / staveWidth));
    const rowCount = Math.ceil(measures.length / stavesPerRow);
    const totalWidth = Math.min(stavesPerRow * staveWidth + 40, container.clientWidth || 800);
    const totalHeight = rowCount * 160 + 80;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(totalWidth, totalHeight);
    const context = renderer.getContext();
    context.setFont('Arial', 10);

    const bpmLabel = document.createElement('div');
    bpmLabel.style.cssText = 'font-size:13px;color:#555;padding:4px 8px;font-family:sans-serif;';
    bpmLabel.textContent = `Tempo ${bpm} BPM | ${notes.length} notes | ${measures.length} measures`;
    container.prepend(bpmLabel);

    measures.forEach((items, index) => {
      const row = Math.floor(index / stavesPerRow);
      const column = index % stavesPerRow;
      const x = 10 + column * staveWidth;
      const y = 40 + row * 160;

      const stave = new Stave(x, y, staveWidth - 10);
      if (index === 0) {
        stave.addClef('treble').addTimeSignature('4/4');
      }
      stave.setContext(context).draw();

      const tickables = [];

      for (const item of items) {
        if (item.type === 'rest') {
          const quantizedRest = quantizeRestBeats(item.beatDur);

          try {
            tickables.push(new StaveNote({ keys: ['b/4'], duration: quantizedRest.vex }));
          } catch {
            tickables.push(new StaveNote({ keys: ['b/4'], duration: 'qr' }));
          }

          continue;
        }

        const quantizedNote = quantizeBeats(item.beatDur);
        const sortedPitches = [...item.pitches].sort((left, right) => left - right);
        const keys = [];
        const accidentals = [];

        for (const midi of sortedPitches) {
          const vexKey = midiToVexKey(midi);
          keys.push(vexKey.key);
          accidentals.push(vexKey.accidental);
        }

        try {
          const staveNote = new StaveNote({
            keys,
            duration: baseDuration(quantizedNote.vex),
          });

          accidentals.forEach((accidental, accidentalIndex) => {
            if (accidental) {
              staveNote.addModifier(new Accidental(accidental), accidentalIndex);
            }
          });

          if (isDotted(quantizedNote.vex)) {
            Dot.buildAndAttach([staveNote], { all: true });
          }

          tickables.push(staveNote);
        } catch {
          tickables.push(new StaveNote({
            keys: keys.length > 0 ? keys : ['c/4'],
            duration: 'q',
          }));
        }
      }

      if (tickables.length === 0) {
        return;
      }

      const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT);
      voice.addTickables(tickables);
      new Formatter().joinVoices([voice]).format([voice], staveWidth - 70);
      voice.draw(context, stave);
    });

    return {
      bpm,
      measuresCount: measures.length,
    };
  }
}
