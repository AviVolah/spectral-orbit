import './style.css';
import { AudioEngine } from './audio-engine.js';
import { createFeedbackStore } from './feedback-store.js';
import { ScoreRenderer } from './score-renderer.js';

const engine = new AudioEngine();
const feedbackStore = createFeedbackStore();
const scoreRenderer = new ScoreRenderer('#score-output');

const btnUpload = document.getElementById('btn-upload');
const btnRecord = document.getElementById('btn-record');
const recordLabel = document.getElementById('record-label');
const fileInput = document.getElementById('file-input');
const btnTranscribe = document.getElementById('btn-transcribe');
const btnDownload = document.getElementById('btn-download');
const fileInfoSection = document.getElementById('file-info-section');
const fileNameEl = document.getElementById('file-name');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const placeholder = document.getElementById('placeholder');
const scoreOutput = document.getElementById('score-output');
const instrumentSelect = document.getElementById('instrument-select');
const feedbackSection = document.getElementById('feedback-section');
const feedbackSummary = document.getElementById('feedback-summary');
const feedbackScope = document.getElementById('feedback-scope');
const feedbackAccuracy = document.getElementById('feedback-accuracy');
const feedbackNotes = document.getElementById('feedback-notes');
const feedbackSaveStatus = document.getElementById('feedback-save-status');
const feedbackList = document.getElementById('feedback-list');
const btnFeedbackSubmit = document.getElementById('btn-feedback-submit');
const feedbackIssueInputs = Array.from(document.querySelectorAll('input[name="feedback-issues"]'));

let pendingAudioBuffer = null;
let pendingSource = {
  type: '',
  label: '',
};
let latestTranscription = null;

function setStatus(text, mode = '') {
  statusText.textContent = text;
  statusBadge.className = `status-badge ${mode}`.trim();
}

function showProgress(show) {
  progressSection.style.display = show ? 'block' : 'none';
}

function setProgress(progressValue) {
  const percentage = Math.round(progressValue * 100);
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${percentage}%`;
}

function roundNumber(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function getInstrumentLabel() {
  return instrumentSelect.options[instrumentSelect.selectedIndex]?.textContent ?? 'General / Auto';
}

function getSelectedFeedbackIssues() {
  return feedbackIssueInputs
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function formatAccuracy(value) {
  if (value === 'accurate') {
    return 'Mostly correct';
  }

  if (value === 'mixed') {
    return 'Partly correct';
  }

  if (value === 'incorrect') {
    return 'Mostly incorrect';
  }

  return 'Unrated';
}

function formatIssueLabel(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getDurationSeconds(notes) {
  return notes.reduce(
    (longest, note) => Math.max(longest, note.startTimeSeconds + note.durationSeconds),
    0,
  );
}

function createNotesPreview(notes) {
  return notes.slice(0, 48).map((note) => ({
    pitchMidi: Math.round(note.pitchMidi),
    startTimeSeconds: roundNumber(note.startTimeSeconds),
    durationSeconds: roundNumber(note.durationSeconds),
  }));
}

function resetFeedbackInputs() {
  feedbackAccuracy.value = '';
  feedbackNotes.value = '';
  feedbackIssueInputs.forEach((input) => {
    input.checked = false;
  });
}

function clearFeedbackState() {
  latestTranscription = null;
  feedbackSection.hidden = true;
  feedbackSaveStatus.textContent = '';
  resetFeedbackInputs();
}

function setPendingSource(type, label) {
  pendingSource = { type, label };
  fileNameEl.textContent = label;
  fileInfoSection.style.display = 'block';
  clearFeedbackState();
}

function updateFeedbackPanel(summary) {
  const pieces = [
    summary.sourceLabel,
    summary.instrumentLabel,
    `${summary.noteCount} notes`,
  ];

  if (summary.measuresCount > 0) {
    pieces.push(`${summary.measuresCount} measures`);
  }

  if (summary.bpm) {
    pieces.push(`${summary.bpm} BPM`);
  }

  feedbackSummary.textContent = pieces.join(' | ');
  feedbackScope.textContent = feedbackStore.isRemoteConfigured()
    ? 'Shared feedback is enabled through VITE_FEEDBACK_API_URL.'
    : 'Saved on this device only until a shared endpoint is configured.';
  feedbackSection.hidden = false;
}

function renderFeedbackList() {
  const entries = feedbackStore.list();
  feedbackList.innerHTML = '';

  if (entries.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'feedback-empty';
    emptyState.textContent = 'No feedback saved on this device yet.';
    feedbackList.append(emptyState);
    return;
  }

  entries.slice(0, 5).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'feedback-entry';

    const header = document.createElement('div');
    header.className = 'feedback-entry-header';

    const accuracy = document.createElement('strong');
    accuracy.textContent = formatAccuracy(entry.accuracy);

    const meta = document.createElement('span');
    meta.className = 'feedback-entry-meta';
    const date = new Date(entry.createdAt);
    const metaBits = [
      Number.isNaN(date.getTime()) ? entry.createdAt : date.toLocaleString(),
      entry.transcription?.instrumentLabel,
      entry.transcription?.sourceLabel,
    ].filter(Boolean);
    meta.textContent = metaBits.join(' | ');

    header.append(accuracy, meta);

    const body = document.createElement('p');
    body.className = 'feedback-entry-body';
    const bodyParts = [];

    if (entry.issues?.length) {
      bodyParts.push(`Needs work: ${entry.issues.map(formatIssueLabel).join(', ')}`);
    }

    if (entry.notes) {
      bodyParts.push(entry.notes);
    }

    body.textContent = bodyParts.join(' | ') || 'No extra notes provided.';

    item.append(header, body);
    feedbackList.append(item);
  });
}

async function submitFeedback() {
  if (!latestTranscription) {
    feedbackSaveStatus.textContent = 'Run a transcription before saving feedback.';
    return;
  }

  if (!feedbackAccuracy.value) {
    feedbackSaveStatus.textContent = 'Choose how accurate the transcription felt first.';
    return;
  }

  btnFeedbackSubmit.disabled = true;
  feedbackSaveStatus.textContent = 'Saving feedback...';

  try {
    const result = await feedbackStore.submit({
      accuracy: feedbackAccuracy.value,
      issues: getSelectedFeedbackIssues(),
      notes: feedbackNotes.value.trim(),
      createdAt: new Date().toISOString(),
      transcription: latestTranscription,
    });

    renderFeedbackList();
    resetFeedbackInputs();

    if (result.remoteSaved) {
      feedbackSaveStatus.textContent = 'Feedback saved locally and synced to shared storage.';
    } else if (result.remoteError) {
      feedbackSaveStatus.textContent = `Feedback saved locally. Shared sync failed: ${result.remoteError}`;
    } else {
      feedbackSaveStatus.textContent = 'Feedback saved on this device.';
    }
  } catch (error) {
    console.error('Feedback save error:', error);
    feedbackSaveStatus.textContent = error instanceof Error
      ? `Could not save feedback: ${error.message}`
      : 'Could not save feedback.';
  } finally {
    btnFeedbackSubmit.disabled = false;
  }
}

btnUpload.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setStatus('Loading file...', 'processing');
    pendingAudioBuffer = await engine.loadFile(file);
    setPendingSource('upload', file.name);
    setStatus('File loaded');
  } catch (error) {
    console.error('File load error:', error);
    alert(`Error loading audio file: ${error.message}`);
    setStatus('Error');
  }
});

btnTranscribe.addEventListener('click', async () => {
  if (!pendingAudioBuffer) {
    alert('No audio loaded. Upload a file or record first.');
    return;
  }

  await runTranscription(pendingAudioBuffer);
});

btnRecord.addEventListener('click', async () => {
  if (engine.isRecording) {
    setStatus('Processing recording...', 'processing');
    recordLabel.textContent = 'Record Audio';
    btnRecord.classList.remove('recording');

    try {
      const audioBuffer = await engine.stopRecording();
      pendingAudioBuffer = audioBuffer;
      setPendingSource('microphone', 'Microphone recording');
      setStatus('Recording ready');
    } catch (error) {
      console.error('Recording error:', error);
      alert(`Error processing recording: ${error.message}`);
      setStatus('Error');
    }
  } else {
    try {
      await engine.startRecording();
      recordLabel.textContent = 'Stop Recording';
      btnRecord.classList.add('recording');
      setStatus('Recording...', 'recording');
    } catch (error) {
      console.error('Mic error:', error);
      alert(`Could not access microphone: ${error.message}`);
    }
  }
});

async function runTranscription(audioBuffer) {
  setStatus('AI transcribing...', 'processing');
  showProgress(true);
  setProgress(0);

  btnTranscribe.disabled = true;
  btnUpload.disabled = true;
  btnRecord.disabled = true;
  btnFeedbackSubmit.disabled = true;

  try {
    const presetKey = instrumentSelect ? instrumentSelect.value : 'general';
    const notes = await engine.transcribe(audioBuffer, presetKey, (progressValue, stage) => {
      setProgress(progressValue);
      if (stage) {
        progressText.textContent = `${Math.round(progressValue * 100)}% | ${stage}`;
      }
    });

    if (placeholder) {
      placeholder.style.display = 'none';
    }

    const renderSummary = scoreRenderer.render(notes);
    latestTranscription = {
      createdAt: new Date().toISOString(),
      sourceType: pendingSource.type || 'unknown',
      sourceLabel: pendingSource.label || fileNameEl.textContent || 'Unknown source',
      instrumentKey: presetKey,
      instrumentLabel: getInstrumentLabel(),
      noteCount: notes.length,
      measuresCount: renderSummary?.measuresCount ?? 0,
      bpm: renderSummary?.bpm ?? null,
      durationSeconds: roundNumber(getDurationSeconds(notes)),
      notesPreview: createNotesPreview(notes),
    };

    updateFeedbackPanel(latestTranscription);
    renderFeedbackList();
    setStatus(`Done - ${notes.length} notes`);
    btnDownload.style.display = 'inline-flex';
  } catch (error) {
    console.error('Transcription error:', error);
    alert(`Transcription failed: ${error.message}`);
    setStatus('Error');
  } finally {
    showProgress(false);
    btnTranscribe.disabled = false;
    btnUpload.disabled = false;
    btnRecord.disabled = false;
    btnFeedbackSubmit.disabled = false;
  }
}

btnDownload.addEventListener('click', () => {
  const svg = scoreOutput.querySelector('svg');
  if (!svg) {
    return;
  }

  const svgData = new XMLSerializer().serializeToString(svg);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const image = new Image();

  image.onload = () => {
    canvas.width = image.width * 2;
    canvas.height = image.height * 2;

    if (!context) {
      return;
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const link = document.createElement('a');
    link.download = 'sheet-music.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
});

btnFeedbackSubmit.addEventListener('click', submitFeedback);
renderFeedbackList();
feedbackScope.textContent = feedbackStore.isRemoteConfigured()
  ? 'Shared feedback is enabled through VITE_FEEDBACK_API_URL.'
  : 'Saved on this device only until a shared endpoint is configured.';
