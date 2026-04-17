import { BasicPitch, noteFramesToTime, outputToNotesPoly, addPitchBendsToNoteEvents } from '@spotify/basic-pitch';

const BASIC_PITCH_SAMPLE_RATE = 22050;

export const INSTRUMENT_PRESETS = {
  general: {
    label: 'General / Auto',
    onsetThresh: 0.5,
    frameThresh: 0.3,
    minNoteLen: 11,
    maxFreq: null,
    minFreq: null,
    melodiaTrick: true,
  },
  piano: {
    label: 'Piano',
    onsetThresh: 0.5,
    frameThresh: 0.3,
    minNoteLen: 11,
    maxFreq: 4200,
    minFreq: 27,
    melodiaTrick: false,
  },
  voice: {
    label: 'Voice / Singing',
    onsetThresh: 0.6,
    frameThresh: 0.4,
    minNoteLen: 15,
    maxFreq: 1100,
    minFreq: 80,
    melodiaTrick: true,
  },
  guitar: {
    label: 'Guitar',
    onsetThresh: 0.5,
    frameThresh: 0.35,
    minNoteLen: 11,
    maxFreq: 1400,
    minFreq: 80,
    melodiaTrick: true,
  },
  violin: {
    label: 'Violin / Strings',
    onsetThresh: 0.55,
    frameThresh: 0.35,
    minNoteLen: 13,
    maxFreq: 3500,
    minFreq: 196,
    melodiaTrick: true,
  },
  flute: {
    label: 'Flute / Woodwinds',
    onsetThresh: 0.55,
    frameThresh: 0.4,
    minNoteLen: 13,
    maxFreq: 2400,
    minFreq: 260,
    melodiaTrick: true,
  },
  bass: {
    label: 'Bass',
    onsetThresh: 0.5,
    frameThresh: 0.3,
    minNoteLen: 11,
    maxFreq: 400,
    minFreq: 30,
    melodiaTrick: false,
  },
};

export class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.basicPitch = null;
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    return this.audioCtx;
  }

  async loadFile(file) {
    const context = this.ensureAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    return context.decodeAudioData(arrayBuffer);
  }

  async startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    this.mediaRecorder.start();
    this.isRecording = true;
  }

  async stopRecording() {
    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const context = this.ensureAudioContext();
          const audioBuffer = await context.decodeAudioData(arrayBuffer);
          resolve(audioBuffer);
        } catch (error) {
          reject(error);
        }
      };

      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      this.isRecording = false;
    });
  }

  normalizeAudio(samples) {
    let peak = 0;

    for (let index = 0; index < samples.length; index += 1) {
      const absolute = Math.abs(samples[index]);
      if (absolute > peak) {
        peak = absolute;
      }
    }

    if (peak < 0.01 || peak > 0.95) {
      return samples;
    }

    const gain = 0.95 / peak;
    const normalized = new Float32Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      normalized[index] = samples[index] * gain;
    }

    return normalized;
  }

  async resampleTo22050Mono(audioBuffer) {
    const sampleCount = Math.ceil(audioBuffer.duration * BASIC_PITCH_SAMPLE_RATE);
    const offlineContext = new OfflineAudioContext(1, sampleCount, BASIC_PITCH_SAMPLE_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    const rawSamples = renderedBuffer.getChannelData(0);
    return this.normalizeAudio(rawSamples);
  }

  async transcribe(audioBuffer, presetKey = 'general', onProgress) {
    const preset = INSTRUMENT_PRESETS[presetKey] || INSTRUMENT_PRESETS.general;
    const report = (progressValue, stage) => {
      if (onProgress) {
        onProgress(progressValue, stage);
      }
    };

    report(0, 'Resampling audio...');
    const monoData = await this.resampleTo22050Mono(audioBuffer);
    report(0.05, 'Resampling complete');

    if (!this.basicPitch) {
      report(0.05, 'Loading AI model...');
      this.basicPitch = new BasicPitch('/model/model.json');
    }

    report(0.1, 'Analyzing audio...');
    const allFrames = [];
    const allOnsets = [];
    const allContours = [];

    await this.basicPitch.evaluateModel(
      monoData,
      (frames, onsets, contours) => {
        allFrames.push(...frames);
        allOnsets.push(...onsets);
        allContours.push(...contours);
      },
      (percent) => {
        report(0.1 + percent * 0.8, 'Analyzing audio...');
      },
    );

    report(0.9, 'Extracting notes...');
    const noteEvents = outputToNotesPoly(
      allFrames,
      allOnsets,
      preset.onsetThresh,
      preset.frameThresh,
      preset.minNoteLen,
      true,
      preset.maxFreq,
      preset.minFreq,
      preset.melodiaTrick,
      5,
    );

    const notesWithBends = addPitchBendsToNoteEvents(allContours, noteEvents);
    const notesInTime = noteFramesToTime(notesWithBends);
    report(1, 'Done');
    return notesInTime;
  }
}
