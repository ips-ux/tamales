// The ready alert of the order tracker: a Web Audio chime and a vibration.
// Browsers block sound and vibration until the customer touches the page, so
// the "Turn On Alerts" button calls `unlockChime` first. No audio file is used.

import { READY_CHIMES, READY_VIBRATION } from "./trackerRules";

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const source = window as Window & { webkitAudioContext?: AudioContextClass };
  return window.AudioContext ?? source.webkitAudioContext ?? null;
}

function getContext(): AudioContext | null {
  if (context) return context;
  const Context = audioContextClass();
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    context = null;
  }
  return context;
}

/** 2 short notes. `start` is in seconds on the audio clock. */
function scheduleChime(audio: AudioContext, start: number, volume: number): void {
  const notes = [
    { frequency: 880, at: 0 },
    { frequency: 1318.5, at: 0.18 }
  ];
  for (const note of notes) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = note.frequency;
    const begin = start + note.at;
    gain.gain.setValueAtTime(0.0001, begin);
    gain.gain.exponentialRampToValueAtTime(volume, begin + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, begin + 0.45);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(begin);
    oscillator.stop(begin + 0.5);
  }
}

/**
 * Call this in the click handler of "Turn On Alerts". It starts the audio and
 * plays 1 quiet chime, so the customer hears that the alert works.
 * Returns false when the browser has no Web Audio.
 */
export async function unlockChime(): Promise<boolean> {
  const audio = getContext();
  if (!audio) return false;
  try {
    if (audio.state === "suspended") await audio.resume();
    scheduleChime(audio, audio.currentTime + 0.05, 0.12);
    return true;
  } catch {
    return false;
  }
}

/** Plays the chime `count` times, 1 each second. Does nothing when the browser blocks the sound. */
export function playReadyChimes(count = READY_CHIMES): void {
  const audio = getContext();
  if (!audio) return;
  const play = () => {
    const start = audio.currentTime + 0.05;
    for (let index = 0; index < count; index += 1) scheduleChime(audio, start + index, 0.35);
  };
  if (audio.state === "suspended") {
    audio.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}

/** Vibrates on phones that can (Android). An iPhone has no web vibration. */
export function vibrateReady(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(READY_VIBRATION);
    }
  } catch {
    // No vibration. The color, the text and the chime still show the alert.
  }
}
