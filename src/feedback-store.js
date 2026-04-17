const FEEDBACK_STORAGE_KEY = 'spectral-orbit.feedback.v1';
const FEEDBACK_LIMIT = 50;

function getStorage() {
  return window.localStorage;
}

function parseEntries(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Could not parse saved feedback:', error);
    return [];
  }
}

function readEntries() {
  return parseEntries(getStorage().getItem(FEEDBACK_STORAGE_KEY));
}

function writeEntries(entries) {
  getStorage().setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(entries.slice(0, FEEDBACK_LIMIT)));
}

function createSubmissionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function saveToRemote(endpoint, submission) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submission),
  });

  if (!response.ok) {
    throw new Error(`Remote feedback save failed with status ${response.status}`);
  }
}

export function createFeedbackStore() {
  const remoteEndpoint = import.meta.env.VITE_FEEDBACK_API_URL?.trim() || '';

  return {
    isRemoteConfigured() {
      return remoteEndpoint.length > 0;
    },

    list() {
      return readEntries();
    },

    async submit(payload) {
      const submission = {
        ...payload,
        id: createSubmissionId(),
      };

      const nextEntries = [submission, ...readEntries()];
      writeEntries(nextEntries);

      let remoteSaved = false;
      let remoteError = '';

      if (remoteEndpoint) {
        try {
          await saveToRemote(remoteEndpoint, submission);
          remoteSaved = true;
        } catch (error) {
          remoteError = error instanceof Error ? error.message : 'Unknown remote save failure';
          console.error('Remote feedback save failed:', error);
        }
      }

      return {
        submission,
        remoteSaved,
        remoteError,
      };
    },
  };
}
