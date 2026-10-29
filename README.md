# Spectral Orbit

Browser-based experimental **audio to sheet music** transcription.

- Upload an audio file or record your instrument.
- Spotify Basic Pitch estimates note pitches, onsets, and durations in the browser.
- Choose an instrument preset, optionally set **known tempo**, and choose **3/4 or 4/4**.
- Score planning quantizes the AI output to 16th-note ticks, preserves independent overlapping
  notes in separate displayed voices, splits notes at barlines, and adds ties.
- VexFlow draws musical notation; the score can be exported as PNG.
- Export the displayed notation as PNG or download **detected MIDI** for correction in
  a notation editor or DAW. MIDI preserves the AI event timing rather than the display quantization.
- Alpha feedback is stored locally, with an optional shared feedback API.

## Limits

This is **not a reliable transcription service yet**. Polyphonic instrument separation,
performance dynamics, tempo changes, swing/tuplets, note onset detection, and pitch
accuracy remain open problems. The auto-BPM estimator is an approximation; manually
enter the real tempo when known. Notation always quantizes to a sixteenth-note grid,
which may be inappropriate for expressive performances. The score planner displays
overlapping lines separately instead of pretending a single musical voice can play them.
Supported meter choices are currently 3/4 and 4/4, with a single estimated/selected
tempo throughout the score.

**Important:** a correctly rendered score does not establish that the model detected
the played notes correctly. Compare against a known reference score before trusting output.

## Development

\`\`\`bash
npm install
npm run dev
npm test
npm run build
\`\`\`

The note detector expects Basic Pitch model assets under \`public/model/\`.
The pure score planner is in \`src/score-planner.js\` and its deterministic
pitch/onset/duration, chord, overlap, and bar-boundary tests are under \`tests/\`.

## Suggested accuracy evaluation before release

1. Record or synthesize 10–20 short instrumental examples with ground-truth
   MIDI/sheet music, covering single-note melodies, chords, sustained notes,
   and timing variations.
2. Compare the **raw Basic Pitch events** with ground truth (pitch, onset, offset,
   precision/recall/F1). This is distinct from the score-rendering errors.
3. Compare the **quantized score** with ground truth and record whether
   human correction is necessary.
4. Retain anonymized, consented musician feedback where appropriate.
5. Only expand to multi-instrument mixtures after simpler inputs are reliable.

Do not interpret the unit tests as a measured gain in transcription-model accuracy.
