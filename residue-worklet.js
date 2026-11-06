/* FridayLolSol / Residue Orchestra — pure client-side cross-interaction DSP.
   Each wet mode vanishes when fewer than two participating sources have signal.
   Pair modes are not an inverse Wigner-Ville transform: they are audible,
   deliberately designed bilinear or envelope-coupled interactions. */
const MAX_TRACKS = 12;
const HISTORY = 16384;

class ResidueEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.settings = {
      mode: 'ring', gains: Array(MAX_TRACKS).fill(1),
      enabled: Array(MAX_TRACKS).fill(false), pairKeys: [],
      drive: 4, wet: 1, dry: 0, highpass: 35,
      lowpass: 13000, delayMs: 21, output: 0.72
    };
    this.pairs = new Set();
    this.hL = Array.from({length: MAX_TRACKS}, () => new Float32Array(HISTORY));
    this.hR = Array.from({length: MAX_TRACKS}, () => new Float32Array(HISTORY));
    this.envL = new Float32Array(MAX_TRACKS);
    this.envR = new Float32Array(MAX_TRACKS);
    this.prevIn = [0, 0];
    this.prevHP = [0, 0];
    this.prevLP = [0, 0];
    this.head = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'settings') {
        const v = e.data.value;
        Object.assign(this.settings, v);
        if (v.pairKeys) this.pairs = new Set(v.pairKeys);
      } else if (e.data && e.data.type === 'reset') {
        for (let i = 0; i < MAX_TRACKS; i++) {
          this.hL[i].fill(0);
          this.hR[i].fill(0);
          this.envL[i] = this.envR[i] = 0;
        }
        this.prevIn.fill(0);
        this.prevHP.fill(0);
        this.prevLP.fill(0);
        this.head = 0;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const s = this.settings;
    const n = out[0].length;
    const xsL = new Float32Array(MAX_TRACKS);
    const xsR = new Float32Array(MAX_TRACKS);
    const decay = Math.exp(-1 / (sampleRate * .04));
    const hp = Math.exp(-2 * Math.PI * Math.max(10, s.highpass) / sampleRate);
    const lp = 1 - Math.exp(-2 * Math.PI * Math.min(sampleRate * .45, Math.max(200, s.lowpass)) / sampleRate);
    const lag = Math.max(1, Math.min(HISTORY - 1, Math.round(sampleRate * s.delayMs / 1000)));
    const drive = Math.max(.01, s.drive);
    for (let f = 0; f < n; f++) {
      const old = (this.head - lag + HISTORY) % HISTORY;
      let dryL = 0, dryR = 0, tracksPresent = 0;
      for (let i = 0; i < MAX_TRACKS; i++) {
        const audio = inputs[i];
        const valid = !!(s.enabled[i] && audio && audio[0]);
        const gain = Number(s.gains[i] || 0);
        const l = valid ? (audio[0][f] || 0) * gain : 0;
        const r = valid ? ((audio[1] || audio[0])[f] || 0) * gain : 0;
        xsL[i] = l; xsR[i] = r;
        dryL += l; dryR += r;
        if (valid) tracksPresent++;
        this.envL[i] = Math.max(Math.abs(l), this.envL[i] * decay);
        this.envR[i] = Math.max(Math.abs(r), this.envR[i] * decay);
        this.hL[i][this.head] = l;
        this.hR[i][this.head] = r;
      }

      let wetL = 0, wetR = 0, pairCount = 0, tripleCount = 0;
      if (s.mode === 'triple') {
        for (let i = 0; i < MAX_TRACKS; i++) {
          if (!s.enabled[i]) continue;
          for (let j = i + 1; j < MAX_TRACKS; j++) {
            if (!s.enabled[j] || !this.pairs.has(i + '-' + j)) continue;
            for (let k = j + 1; k < MAX_TRACKS; k++) {
              if (!s.enabled[k] || !this.pairs.has(i + '-' + k) || !this.pairs.has(j + '-' + k)) continue;
              wetL += xsL[i] * xsL[j] * xsL[k] * 8;
              wetR += xsR[i] * xsR[j] * xsR[k] * 8;
              tripleCount++;
            }
          }
        }
      } else {
        for (let i = 0; i < MAX_TRACKS; i++) {
          if (!s.enabled[i]) continue;
          for (let j = i + 1; j < MAX_TRACKS; j++) {
            if (!s.enabled[j] || !this.pairs.has(i + '-' + j)) continue;
            const a = xsL[i], b = xsL[j], ar = xsR[i], br = xsR[j];
            if (s.mode === 'weave') {
              wetL += 4 * (a * this.hL[j][old] - b * this.hL[i][old]);
              wetR += 4 * (ar * this.hR[j][old] - br * this.hR[i][old]);
            } else if (s.mode === 'imprint') {
              wetL += 2 * (a * this.envL[j] - b * this.envL[i]);
              wetR += 2 * (ar * this.envR[j] - br * this.envR[i]);
            } else {
              wetL += 2 * a * b;
              wetR += 2 * ar * br;
            }
            pairCount++;
          }
        }
      }
      const count = s.mode === 'triple' ? tripleCount : pairCount;
      const norm = count ? 1 / Math.sqrt(count) : 0;
      wetL *= norm; wetR *= norm;
      const result = [wetL, wetR];
      for (let ch = 0; ch < out.length; ch++) {
        const k = Math.min(ch, 1);
        const v = result[k] * drive * 8;
        const hpv = hp * (this.prevHP[k] + v - this.prevIn[k]);
        this.prevIn[k] = v;
        this.prevHP[k] = hpv;
        this.prevLP[k] += lp * (hpv - this.prevLP[k]);
        const wet = Math.tanh(this.prevLP[k]);
        const dry = k === 0 ? dryL : dryR;
        out[ch][f] = Math.tanh((s.wet * wet + s.dry * dry / Math.max(1, tracksPresent)) * s.output);
      }
      this.head = (this.head + 1) % HISTORY;
    }
    return true;
  }
}
registerProcessor('residue-engine', ResidueEngine);
