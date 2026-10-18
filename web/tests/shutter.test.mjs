import { playShutter } from '../src/services/shutter.ts';

let failures = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`);
  }
}

class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeGain {
  gain = new FakeParam();
  disconnectCalls = 0;
  connect() {}
  disconnect() { this.disconnectCalls += 1; }
}

class FakeOscillator {
  type = '';
  frequency = new FakeParam();
  onended = null;
  connect() {}
  start() {
    if (audio.state !== 'running') throw new Error('Audio started while suspended');
    audio.started += 1;
  }
  stop() {}
  disconnect() {}
}

class FakeAudioContext {
  state = 'suspended';
  currentTime = 1;
  destination = {};
  started = 0;
  resumeNow = null;
  gains = [];
  oscillators = [];
  resume() {
    return new Promise((resolve) => {
      this.resumeNow = () => {
        this.state = 'running';
        resolve();
      };
    });
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

const audio = new FakeAudioContext();
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', { value: { AudioContext: class { constructor() { return audio; } } }, configurable: true, writable: true });

console.log('capture chime waits for an active audio context and releases its nodes');
const playing = playShutter(40);
check('no note is scheduled while the audio context is suspended', audio.started === 0);
audio.resumeNow?.();
await playing;
check('all three notes start after the context resumes', audio.state === 'running' && audio.started === 3);
const master = audio.gains[0];
for (const oscillator of audio.oscillators) oscillator.onended?.();
check('the chime disconnects its audio graph when the notes finish', master?.disconnectCalls === 1 && audio.gains.slice(1).every((gain) => gain.disconnectCalls === 1));

if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
else delete globalThis.window;

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
