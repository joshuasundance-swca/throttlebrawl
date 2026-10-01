// A minimal stand-in for AudioContext, for unit tests in Node (which has no WebAudio). It records
// the calls this module makes, so tests can assert what the graph was told to do. Only the tests
// import it; the real patch is exercised in a browser by tests/e2e/audio-engine.spec.ts.

export interface ParamCall {
  method: string;
  value: number;
  time: number;
}

export class FakeParam {
  value: number;
  readonly calls: ParamCall[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  /** The value the last scheduled call aims for (what the param settles to). */
  get target(): number {
    return this.calls.at(-1)?.value ?? this.value;
  }
  private rec(method: string, value: number, time: number) {
    this.calls.push({ method, value, time });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.rec('setValueAtTime', v, t);
  }
  setTargetAtTime(v: number, t: number) {
    return this.rec('setTargetAtTime', v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.rec('linearRampToValueAtTime', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.rec('exponentialRampToValueAtTime', v, t);
  }
  cancelScheduledValues(t: number) {
    return this.rec('cancelScheduledValues', Number.NaN, t);
  }
}

export class FakeNode {
  readonly kind: string;
  readonly outputs: FakeNode[] = [];
  gain = new FakeParam(1);
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  Q = new FakeParam(1);
  threshold = new FakeParam(-24);
  ratio = new FakeParam(12);
  knee = new FakeParam(30);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  playbackRate = new FakeParam(1);
  delayTime = new FakeParam(0);
  type = '';
  curve: Float32Array | null = null;
  buffer: unknown = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect<T>(dest: T): T {
    if (dest instanceof FakeNode) this.outputs.push(dest);
    return dest;
  }
  disconnect() {
    this.outputs.length = 0;
  }
  start(t = 0) {
    this.startedAt = t;
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
  setPeriodicWave(_wave: unknown) {
    this.type = 'custom';
  }
  /** Ends a source now, as the browser would when its stop time passes. */
  end() {
    this.onended?.();
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'suspended';
  readonly destination = new FakeNode('destination');
  readonly nodes: FakeNode[] = [];
  private make(kind: string) {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.make('gain');
  }
  createOscillator() {
    return this.make('oscillator');
  }
  createBiquadFilter() {
    return this.make('biquad');
  }
  createDynamicsCompressor() {
    return this.make('compressor');
  }
  createDelay(_max = 1) {
    return this.make('delay');
  }
  createWaveShaper() {
    return this.make('shaper');
  }
  createBufferSource() {
    return this.make('bufferSource');
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, getChannelData: () => data };
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    return { real, imag };
  }
  /** Bytes decoded so far (spoken barks); a "clip" lasts one second per 1000 bytes. */
  readonly decoded: number[] = [];
  decodeAudioData(data: ArrayBuffer) {
    this.decoded.push(data.byteLength);
    if (data.byteLength === 0) return Promise.reject(new Error('EncodingError'));
    return Promise.resolve({
      duration: data.byteLength / 1000,
      length: data.byteLength,
      numberOfChannels: 1,
    });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  /** Nodes of one kind that are wired straight into `dest`. */
  inputsOf(dest: FakeNode, kind?: string) {
    return this.nodes.filter((n) => n.outputs.includes(dest) && (!kind || n.kind === kind));
  }
  /** Sources started and not yet stopped. */
  running(kind?: string) {
    return this.nodes.filter(
      (n) =>
        (n.kind === 'oscillator' || n.kind === 'bufferSource') &&
        (!kind || n.kind === kind) &&
        n.startedAt !== null &&
        n.stoppedAt === null,
    );
  }
}

/** The fake, typed as the real thing for createAudio's context factory. */
export function fakeContextFactory(): { ctx: FakeAudioContext; create: () => AudioContext } {
  const ctx = new FakeAudioContext();
  return { ctx, create: () => ctx as unknown as AudioContext };
}
