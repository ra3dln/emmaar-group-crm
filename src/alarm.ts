// ===== محرك المنبه: يرنّ باستمرار كالمنبه الحقيقي حتى يُسكَت أو يُقفَل من داخل الموقع =====
// يعتمد على Web Audio (صفارة متكررة) + اهتزاز + إبقاء الشاشة مضاءة.
// ملاحظة مهمة: المتصفح يمنع تشغيل الصوت تلقائياً قبل أول تفاعل من المستخدم،
// لذلك نُجهّز المحرك عند أول ضغطة (unlock) ثم يعمل المنبه بعدها دائماً.

export type AlarmSound = 'bell' | 'beep';

export type AlarmSettings = {
  enabled: boolean;
  sound: AlarmSound;
  durationSec: number;
  volume: number;
  snoozeMin: number;
  vibrate: boolean;
};

export const DEFAULT_ALARM_SETTINGS: AlarmSettings = {
  enabled: true,
  sound: 'bell',
  durationSec: 30,
  volume: 0.85,
  snoozeMin: 5,
  vibrate: true,
};

const SETTINGS_KEY = 'crm_alarm_settings';

export function loadAlarmSettings(): AlarmSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_ALARM_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_ALARM_SETTINGS };
  }
}

export function saveAlarmSettings(settings: AlarmSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* لا شيء */
  }
}

type Tone = { osc: OscillatorNode; gain: GainNode; lfo?: OscillatorNode; lfoGain?: GainNode };

class AlarmEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private tones: Tone[] = [];
  private patternTimer: number | null = null;
  private vibrationTimer: number | null = null;
  private stopTimer: number | null = null;
  private wakeLock: any = null;
  private ringing = false;

  get isRinging(): boolean {
    return this.ringing;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  // يُنادى عند أول ضغطة من المستخدم لفتح الصوت (سياسة المتصفحات)
  unlock(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // نبضة صامتة لفتح القناة الصوتية
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    } catch {
      /* لا شيء */
    }
    return ctx.state !== 'closed';
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      const api = (navigator as any).wakeLock;
      if (api?.request) this.wakeLock = await api.request('screen');
    } catch {
      /* غير مدعوم */
    }
  }

  private releaseWakeLock(): void {
    try {
      this.wakeLock?.release?.();
    } catch {
      /* لا شيء */
    }
    this.wakeLock = null;
  }

  private setMediaSession(title: string, body: string): void {
    try {
      const ms = (navigator as any).mediaSession;
      if (!ms) return;
      ms.metadata = new (window as any).MediaMetadata({ title, artist: body, album: 'MSA CRM' });
      ms.playbackState = 'playing';
    } catch {
      /* غير مدعوم */
    }
  }

  private buildTone(type: OscillatorType, frequency: number, volume: number, withLfo: boolean): Tone | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    const tone: Tone = { osc, gain };
    if (withLfo) {
      // تردد يعلو وينخفض => صوت صفارة إنذار حقيقية
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.55;
      lfoGain.gain.value = frequency * 0.55;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();
      tone.lfo = lfo;
      tone.lfoGain = lfoGain;
    }
    this.tones.push(tone);
    return tone;
  }

  private clearTones(): void {
    for (const tone of this.tones) {
      try {
        tone.osc.stop();
        tone.osc.disconnect();
        tone.gain.disconnect();
        tone.lfo?.stop();
        tone.lfo?.disconnect();
        tone.lfoGain?.disconnect();
      } catch {
        /* لا شيء */
      }
    }
    this.tones = [];
  }

  private startPattern(sound: AlarmSound, volume: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // جرس أو نبضات: نغمة قصيرة متكررة بفاصل هادئ (مثل نغمة التذكيرات الأصلية)
    const beep = () => {
      if (!this.ringing) return;
      const now = ctx.currentTime;
      const freqs = sound === 'bell' ? [880, 660] : [1000, 760];
      freqs.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = sound === 'bell' ? 'triangle' : 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now + index * 0.22);
        gain.gain.linearRampToValueAtTime(volume, now + index * 0.22 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.22 + 0.20);
        osc.connect(gain);
        gain.connect(this.master!);
        osc.start(now + index * 0.22);
        osc.stop(now + index * 0.22 + 0.24);
      });
    };
    beep();
    const gap = sound === 'bell' ? 900 : 700;
    this.patternTimer = window.setInterval(beep, gap);
  }

  // تشغيل المنبه لمدة محددة (بالثواني) — ويرنّ حتى الإسكات أو انتهاء المدة
  start(opts: { sound: AlarmSound; volume: number; durationSec: number; vibrate: boolean; title: string; body: string; onEnd?: () => void }): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    this.stop(true);
    this.ringing = true;
    this.master = ctx.createGain();
    this.master.gain.value = Math.min(1, Math.max(0.05, opts.volume));
    this.master.connect(ctx.destination);

    this.startPattern(opts.sound, 1);
    this.setMediaSession(opts.title, opts.body);
    this.acquireWakeLock();

    if (opts.vibrate && 'vibrate' in navigator) {
      const buzz = () => navigator.vibrate([500, 250, 500, 250, 500, 250]);
      buzz();
      this.vibrationTimer = window.setInterval(buzz, 2400);
    }

    const seconds = Math.max(3, Math.min(1800, Number(opts.durationSec) || 120));
    this.stopTimer = window.setTimeout(() => {
      this.stop();
      opts.onEnd?.();
    }, seconds * 1000);
    return true;
  }

  // إسكات فوري (يبقى المنبه على الشاشة لكن بلا صوت)
  stop(silent = false): void {
    if (this.patternTimer !== null) {
      clearInterval(this.patternTimer);
      this.patternTimer = null;
    }
    if (this.vibrationTimer !== null) {
      clearInterval(this.vibrationTimer);
      this.vibrationTimer = null;
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    try {
      if ('vibrate' in navigator) navigator.vibrate(0);
    } catch {
      /* لا شيء */
    }
    this.clearTones();
    try {
      this.master?.disconnect();
    } catch {
      /* لا شيء */
    }
    this.master = null;
    this.ringing = false;
    this.releaseWakeLock();
    try {
      const ms = (navigator as any).mediaSession;
      if (ms) ms.playbackState = 'none';
    } catch {
      /* لا شيء */
    }
    if (!silent) {
      /* إسكات بناءً على طلب المستخدم */
    }
  }
}

export const alarm = new AlarmEngine();
