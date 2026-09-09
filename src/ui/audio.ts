/**
 * 효과음은 전부 여기서 합성한다. 오디오 파일이 없으므로 로딩도 없다.
 * 브라우저 정책상 첫 사용자 입력 전에는 소리를 낼 수 없어 unlock() 을 먼저 부른다.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;

    const frames = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
  }

  private out(): { ctx: AudioContext; master: GainNode } | null {
    if (this.muted || !this.ctx || !this.master) return null;
    return { ctx: this.ctx, master: this.master };
  }

  private blip(
    freq: number,
    opts: { gain: number; decay: number; type?: OscillatorType; to?: number; delay?: number },
  ): void {
    const io = this.out();
    if (!io) return;
    const t0 = io.ctx.currentTime + (opts.delay ?? 0);
    const osc = io.ctx.createOscillator();
    const gain = io.ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.decay);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
    osc.connect(gain).connect(io.master);
    osc.start(t0);
    osc.stop(t0 + opts.decay + 0.05);
  }

  private hiss(opts: { gain: number; decay: number; from: number; to: number; q?: number }): void {
    const io = this.out();
    if (!io || !this.noise) return;
    const t0 = io.ctx.currentTime;
    const src = io.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = io.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = opts.q ?? 1.2;
    band.frequency.setValueAtTime(opts.from, t0);
    band.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.decay);
    const gain = io.ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.decay);
    src.connect(band).connect(gain).connect(io.master);
    src.start(t0);
    src.stop(t0 + opts.decay + 0.05);
  }

  /** 못 가는 칸에 부딪혔을 때의 "띵" */
  ding(): void {
    this.blip(1244, { gain: 0.3, decay: 0.75 });
    this.blip(1244 * 2.04, { gain: 0.11, decay: 0.42 });
    this.blip(1244 * 3.02, { gain: 0.05, decay: 0.22 });
    this.hiss({ gain: 0.05, decay: 0.06, from: 2600, to: 1400, q: 2 });
  }

  /** 한 칸 굴러 착지 */
  land(): void {
    this.blip(150, { gain: 0.28, decay: 0.16, type: 'sine', to: 78 });
    this.hiss({ gain: 0.07, decay: 0.09, from: 900, to: 260 });
  }

  /** 스위치를 밟아 색이 바뀜 */
  paint(): void {
    this.blip(430, { gain: 0.18, decay: 0.22, type: 'triangle', to: 880 });
    this.blip(880, { gain: 0.1, decay: 0.3, type: 'sine', delay: 0.06 });
  }

  /** 출구 구멍으로 들어가기 시작할 때 */
  enter(): void {
    this.blip(320, { gain: 0.16, decay: 1.1, type: 'sine', to: 120 });
    this.hiss({ gain: 0.06, decay: 0.9, from: 700, to: 160, q: 0.9 });
  }

  turn(): void {
    this.hiss({ gain: 0.09, decay: 0.3, from: 380, to: 1500 });
  }

  /** 문이 열리고 닫히는 소리. 돌쩌귀가 돌고 빗장이 풀린다. */
  gate(open: boolean): void {
    this.hiss({ gain: 0.1, decay: 0.55, from: open ? 320 : 900, to: open ? 900 : 260, q: 0.8 });
    this.blip(open ? 392 : 294, { gain: 0.14, decay: 0.5, type: 'triangle', to: open ? 587 : 196 });
    if (open) this.blip(784, { gain: 0.09, decay: 0.6, type: 'sine', delay: 0.14 });
  }

  /**
   * 카메라가 확 물러날 때 부는 바람.
   * 잡음을 넓은 밴드패스로 훑어 올렸다 내리면서 길게 부풀린다 — 한 번 훅 지나가는 돌풍.
   */
  wind(seconds: number): void {
    const io = this.out();
    if (!io || !this.noise) return;
    const t0 = io.ctx.currentTime;
    const src = io.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const band = io.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.55;
    band.frequency.setValueAtTime(240, t0);
    band.frequency.exponentialRampToValueAtTime(1100, t0 + seconds * 0.42);
    band.frequency.exponentialRampToValueAtTime(300, t0 + seconds);

    const gain = io.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + seconds * 0.34);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);

    src.connect(band).connect(gain).connect(io.master);
    src.start(t0);
    src.stop(t0 + seconds + 0.1);
  }

  clear(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.blip(f, { gain: 0.22, decay: 0.5, type: 'triangle', delay: i * 0.09 });
    });
  }
}
