import {
  Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot, StaveTie,
} from 'vexflow';
import { planScore } from './score-planner.js';

const NOTE_NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const ACCIDENTALS = [null, '#', null, 'b', null, null, '#', null, 'b', null, null, 'b', null];

function midiToKey(midi) {
  const pitch = Math.round(midi);
  const index = ((pitch % 12) + 12) % 12;
  return {
    key: NOTE_NAMES[index] + '/' + (Math.floor(pitch / 12) - 1),
    accidental: ACCIDENTALS[index],
  };
}

function noteFromEvent(event, clef) {
  const isRest = event.kind === 'rest';
  const baseDuration = event.duration.replace('d', '');
  const duration = baseDuration + (isRest ? 'r' : '');
  const pitches = isRest ? [clef === 'bass' ? 'd/3' : 'b/4']
    : event.pitches.map((midi) => midiToKey(midi).key);
  const note = new StaveNote({
    keys: pitches,
    duration,
    clef,
  });

  if (!isRest) {
    event.pitches.forEach((midi, index) => {
      const { accidental } = midiToKey(midi);
      if (accidental) note.addModifier(new Accidental(accidental), index);
    });
  }
  if (event.duration.endsWith('d')) Dot.buildAndAttach([note], { all: true });
  return note;
}

export class ScoreRenderer {
  constructor(containerSelector) {
    this.containerSelector = containerSelector;
  }

  render(notes, options = {}) {
    const container = document.querySelector(this.containerSelector);
    if (!container) return null;
    container.replaceChildren();

    if (!notes?.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No notes detected. Try a shorter, cleaner recording with a single instrument.';
      empty.style.cssText = 'padding:2rem;color:#999;';
      container.append(empty);
      return null;
    }

    const plan = planScore(notes, options);
    const width = Math.max(320, container.clientWidth || 740);
    const measureWidth = 330;
    const perRow = Math.max(1, Math.min(3, Math.floor((width - 20) / measureWidth)));
    const rowHeight = plan.voiceCount * 132 + 42;
    const rows = Math.ceil(plan.bars.length / perRow);
    const height = Math.max(160, rows * rowHeight + 20);

    const info = document.createElement('p');
    info.style.cssText = 'font:13px sans-serif;padding:8px 10px;margin:0;line-height:1.6;color:#555;';
    info.textContent = [
      (plan.tempoWasEstimated ? 'Estimated tempo: ' : 'Tempo: ') + plan.bpm + ' BPM',
      plan.beatsPerBar + '/4',
      notes.length + ' detected notes',
      plan.bars.length + ' measures',
      plan.voiceCount + (plan.voiceCount === 1 ? ' voice' : ' voices'),
    ].join(' | ') + (plan.warnings.length ? ' | ' + plan.warnings.join(' ') : '');
    container.append(info);

    const host = document.createElement('div');
    container.append(host);
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(Math.max(width, perRow * measureWidth + 20), height);
    const context = renderer.getContext();
    const previousNotes = new Map();
    const ties = [];

    for (let measureIndex = 0; measureIndex < plan.bars.length; measureIndex++) {
      const column = measureIndex % perRow;
      const row = Math.floor(measureIndex / perRow);
      for (let voiceIndex = 0; voiceIndex < plan.voiceCount; voiceIndex++) {
        const clef = plan.voiceClefs[voiceIndex];
        const x = 10 + column * measureWidth;
        const y = 20 + row * rowHeight + voiceIndex * 132;
        const stave = new Stave(x, y, measureWidth - 10);
        if (column === 0) {
          stave.addClef(clef);
          if (measureIndex === 0) {
            stave.addTimeSignature(plan.beatsPerBar + '/4');
          }
        }
        stave.setContext(context).draw();

        const events = plan.bars[measureIndex][voiceIndex];
        const tickables = events.map((event) => noteFromEvent(event, clef));
        const voice = new Voice({
          num_beats: plan.beatsPerBar,
          beat_value: 4,
        });
        // Every planned voice has the exact number of ticks in its bar.
        voice.setMode(Voice.Mode.STRICT);
        voice.addTickables(tickables);
        new Formatter().joinVoices([voice]).format([voice], measureWidth - (column === 0 ? 100 : 54));
        voice.draw(context, stave);

        events.forEach((event, index) => {
          if (event.kind !== 'note') return;
          const current = tickables[index];
          const prior = previousNotes.get(voiceIndex);
          if (event.tieFromPrevious && prior?.groupId === event.groupId) {
            const indices = event.pitches.map((_, n) => n);
            ties.push(new StaveTie({
              first_note: prior.note,
              last_note: current,
              first_indices: indices,
              last_indices: indices,
            }));
          }
          previousNotes.set(voiceIndex, { note: current, groupId: event.groupId });
        });
      }
    }

    for (const tie of ties) {
      tie.setContext(context).draw();
    }

    return {
      bpm: plan.bpm,
      measuresCount: plan.bars.length,
      voiceCount: plan.voiceCount,
      warnings: plan.warnings,
    };
  }
}
