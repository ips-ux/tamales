// The alert for a new live order on the Live POS screens: which orders are
// new since the last look (pure), and a short chime (Web Audio, no file).

/**
 * Compares the order ids on screen with the ids already known.
 * `known` is null before the first load: those orders are not new.
 */
export function findNewIds(
  known: ReadonlySet<string> | null,
  ids: string[]
): { fresh: string[]; known: Set<string> } {
  const next = new Set(known ?? []);
  const fresh: string[] = [];
  for (const id of ids) {
    if (next.has(id)) continue;
    next.add(id);
    if (known) fresh.push(id);
  }
  return { fresh, known: next };
}

// A browser blocks sound until the person touches the page. Record the first touch.
let interacted = false;
let listening = false;
let audioContext: AudioContext | null = null;

/** Starts to watch for the owner's first touch or key press. Safe to call many times. */
export function armChime(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mark = () => {
    interacted = true;
    window.removeEventListener("pointerdown", mark);
    window.removeEventListener("keydown", mark);
  };
  window.addEventListener("pointerdown", mark);
  window.addEventListener("keydown", mark);
}

/** Plays 2 short tones. Does nothing before the owner has touched the page. */
export function playChime(): void {
  if (!interacted || typeof window === "undefined") return;
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audioContext ??= new Context();
    const context = audioContext;
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    [880, 1175].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.32);
    });
  } catch {
    // Sound is the second signal. The badge still shows.
  }
}
