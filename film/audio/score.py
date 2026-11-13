"""
VEYRA HEIST: the score and sound design, synthesized from the film's cue sheet.

Everything here is generated: no samples, no libraries of sounds. Music is in D minor at 96 BPM
(one beat = 15 frames at 24 fps, so every cut lands on the beat). Sound effects are placed at the
exact frames listed in src/cues.json, which the picture reads too.

    python3 audio/score.py            -> audio/stems/music.wav, sfx.wav, mix.wav (48 kHz stereo)

Requires numpy and scipy.
"""
import json
import math
import os
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48_000
HERE = os.path.dirname(os.path.abspath(__file__))
CUES = json.load(open(os.path.join(HERE, "..", "src", "cues.json")))
FPS, BEAT_F = CUES["fps"], CUES["beat"]
DUR = CUES["duration"] / FPS + 2.0  # a little tail for the reverb
N = int(DUR * SR)
BEAT = BEAT_F / FPS  # 0.625 s
rng = np.random.default_rng(7)


def t_of(frame):
    return frame / FPS


def idx(sec):
    return int(round(sec * SR))


def env(n, a=0.005, d=0.3, curve=4.0):
    """Attack then exponential decay over n samples."""
    t = np.arange(n) / SR
    e = np.exp(-t / max(d, 1e-4))
    att = np.clip(t / max(a, 1e-4), 0, 1)
    return (att * e) ** (curve / 4.0)


def lp(x, hz, order=2):
    return sosfilt(butter(order, min(hz, SR / 2 - 100) / (SR / 2), "low", output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz / (SR / 2), "high", output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], "band", output="sos"), x)


def noise(n):
    return rng.standard_normal(n)


def note(m):
    """MIDI note number to Hz."""
    return 440.0 * 2 ** ((m - 69) / 12)


def pan(x, p):
    """Equal-power pan, p in -1..1."""
    a = (p + 1) * math.pi / 4
    return np.stack([x * math.cos(a), x * math.sin(a)])


class Bus:
    def __init__(self):
        self.y = np.zeros((2, N))

    def add(self, sig, at_sec, p=0.0, gain=1.0):
        s = pan(sig, p) if sig.ndim == 1 else sig
        i = idx(at_sec)
        if i >= N:
            return
        j = min(N, i + s.shape[1])
        self.y[:, i:j] += gain * s[:, : j - i]


# ------------------------------------------------------------------------------------------ voices

def sine(f, n, phase=0.0):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t + phase)


def saw_stack(f, n, voices=5, detune=0.12):
    """A detuned supersaw, softened."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(voices):
        d = (k - (voices - 1) / 2) * detune / voices
        fk = f * 2 ** (d / 12)
        ph = rng.random()
        out += 2 * ((t * fk + ph) % 1.0) - 1
    return out / voices


def fm_bell(f, n, ratio=3.5, index=2.2, decay=1.8):
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t / (decay * 0.5))
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t / decay)


def metal(n, base=420.0, decay=0.9, partials=(1.0, 2.76, 5.4, 8.93, 13.34), bright=1.0):
    """Inharmonic struck metal."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, r in enumerate(partials):
        out += np.sin(2 * np.pi * base * r * t + rng.random() * 6) * np.exp(-t / (decay / (1 + k * 0.6 * bright))) / (1 + k)
    return out


def kick(n=None, f0=95, f1=38, d=0.32):
    n = n or idx(0.6)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.045)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / d)


# ------------------------------------------------------------------------------------------ music

def build_music():
    m = Bus()
    D2, F2, G2, A2, Bb2, C3 = 38, 41, 43, 45, 46, 48
    prog = {  # chords as MIDI notes (pad)
        "Dm": [50, 57, 62, 65], "Bb": [46, 53, 58, 62], "F": [41, 53, 57, 60], "C": [48, 55, 60, 64], "Gm": [43, 55, 58, 62], "Dadd9": [50, 57, 64, 66],
    }

    def pad(chord, at, dur, gain=0.11, cutoff=1800, attack=1.2):
        n = idx(dur + 2.5)
        sig = np.zeros(n)
        for mm in chord:
            sig += saw_stack(note(mm), n)
        e = np.clip(np.arange(n) / SR / attack, 0, 1) * np.clip((dur + 2.5 - np.arange(n) / SR) / 2.5, 0, 1)
        sig = lp(sig * e, cutoff, 2) * gain
        m.add(sig, at, p=-0.25, gain=1)
        m.add(sig[::-1][::-1] * 0.9, at + 0.011, p=0.25)  # a second, slightly late copy widens it

    def drone(a, b, gain=0.16):
        n = idx(b - a + 2)
        t = np.arange(n) / SR
        lfo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * t)
        sig = (sine(note(26), n) * 0.7 + sine(note(33), n) * 0.35 + lp(noise(n), 180) * 0.25) * lfo
        fade = np.clip(t / 2.0, 0, 1) * np.clip((b - a + 2 - t) / 2.0, 0, 1)
        m.add(sig * fade * gain, a, p=-0.1)
        m.add(sig * fade * gain * 0.8, a + 0.017, p=0.1)

    def beats(a, b):
        k = 0
        x = a
        while x < b - 1e-6:
            yield k, x
            k += 1
            x += BEAT

    def arp(a, b, notes, step=BEAT / 4, gain=0.05, oct_=12, pan_sweep=True):
        k = 0
        x = a
        while x < b - 1e-6:
            mm = notes[k % len(notes)] + oct_
            s = fm_bell(note(mm), idx(0.5), ratio=2.0, index=1.2, decay=0.22)
            m.add(s * gain, x, p=(math.sin(k * 0.7) * 0.6) if pan_sweep else 0)
            k += 1
            x += step

    def bassline(a, b, pattern, gain=0.18, length=0.42):
        for k, x in beats(a, b):
            mm = pattern[k % len(pattern)]
            n = idx(length + 0.2)
            s = (saw_stack(note(mm), n, voices=3, detune=0.05) * 0.6 + sine(note(mm), n)) * env(n, 0.006, length)
            m.add(lp(s, 700) * gain, x)

    def drums(a, b, kick_on=(0,), hat=True, snare=(), gain=1.0):
        for k, x in beats(a, b):
            if (k % 4) in kick_on:
                m.add(kick() * 0.5 * gain, x)
            if (k % 4) in snare:
                n = idx(0.3)
                s = hp(noise(n), 1400) * env(n, 0.001, 0.09) * 0.22 + sine(190, n) * env(n, 0.001, 0.06) * 0.2
                m.add(s * gain, x, p=0.05)
            if hat:
                for half in (0, 0.5):
                    n = idx(0.08)
                    s = hp(noise(n), 7000) * env(n, 0.0005, 0.018) * 0.07
                    m.add(s * gain, x + half * BEAT, p=0.35 if half else -0.35)

    for seg in CUES["music"]:
        a, b, part = t_of(seg["from"]), t_of(seg["to"]), seg["part"]
        if part == "drone":
            drone(a, b)
        elif part == "pulse":
            drone(a, b, 0.1)
            for k, x in beats(a, b):
                m.add(kick(f0=70, f1=34, d=0.5) * 0.42, x)
            bars = int((b - a) / (BEAT * 4)) + 1
            for i in range(bars):
                pad(prog[["Dm", "Dm", "Bb", "Gm"][i % 4]], a + i * BEAT * 4, BEAT * 4, gain=0.07, cutoff=900 + i * 120)
        elif part == "build":
            drone(a, b, 0.08)
            drums(a, b, kick_on=(0, 2), hat=True)
            arp(a, b, [50, 53, 57, 60, 62, 60, 57, 53], gain=0.04)
            bars = int((b - a) / (BEAT * 4)) + 1
            for i in range(bars):
                pad(prog[["Dm", "Bb", "F", "C"][i % 4]], a + i * BEAT * 4, BEAT * 4, gain=0.08, cutoff=1100 + i * 260)
        elif part == "groove":
            drums(a, b, kick_on=(0, 2), snare=(1, 3), hat=True, gain=0.8)
            bassline(a, b, [D2, D2, F2, G2, D2, D2, Bb2, A2], gain=0.16)
            arp(a, b, [62, 65, 69, 72], step=BEAT / 2, gain=0.035)
            bars = int((b - a) / (BEAT * 4)) + 1
            for i in range(bars):
                pad(prog[["Dm", "Bb", "F", "C"][i % 4]], a + i * BEAT * 4, BEAT * 4, gain=0.05, cutoff=1400)
        elif part == "tension":
            drone(a, b, 0.12)
            k = 0
            x = a
            while x < b:
                n = idx(0.14)
                s = (saw_stack(note(D2 + 12), n, 3, 0.04) * 0.5 + sine(note(D2), n)) * env(n, 0.003, 0.08)
                m.add(lp(s, 900 + 2200 * (x - a) / (b - a)) * 0.15, x)
                k += 1
                x += BEAT / 4
            n = idx(b - a)
            trem = saw_stack(note(74), n, 4, 0.2) * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * np.arange(n) / SR))
            ramp_ = np.linspace(0, 1, n) ** 2
            m.add(lp(trem, 3000) * ramp_ * 0.04, a, p=0.3)
        elif part == "air":
            # the white opening: a high, open chord that breathes, and a few glass notes
            pad(prog["Dadd9"], a, b - a, gain=0.055, cutoff=2600, attack=2.8)
            pad([74, 81, 86], a + 2.0, b - a - 2.0, gain=0.03, cutoff=5000, attack=3.0)
            for i, x in enumerate(np.arange(a + 0.6, b, BEAT * 2)):
                mm = [74, 81, 78, 86, 76, 81][i % 6]
                m.add(fm_bell(note(mm), idx(3.0), ratio=3.0, index=0.9, decay=1.8) * 0.03, x, p=math.sin(i) * 0.5)
        elif part == "drive":
            # the escalation: a groove that tightens, with a pulse whose filter opens vault by vault
            drums(a, b, kick_on=(0, 2), snare=(1, 3), hat=True, gain=0.85)
            bassline(a, b, [D2, D2, F2, D2, G2, D2, Bb2, A2], gain=0.15)
            x = a
            while x < b:
                n = idx(0.12)
                prog_ = (x - a) / (b - a)
                sig = (saw_stack(note(D2 + 24), n, 3, 0.06) * 0.6 + sine(note(D2 + 12), n)) * env(n, 0.002, 0.07)
                m.add(lp(sig, 700 + 3800 * prog_) * (0.05 + 0.05 * prog_), x, p=0.2 if int((x - a) / (BEAT / 4)) % 2 else -0.2)
                x += BEAT / 4
            bars = int((b - a) / (BEAT * 4)) + 1
            for i in range(bars):
                pad(prog[["Dm", "Bb", "Gm", "C"][i % 4]], a + i * BEAT * 4, BEAT * 4, gain=0.05, cutoff=1200 + i * 90)
        elif part == "triumph":
            for i, ch in enumerate(["Bb", "F", "Dadd9"]):
                pad(prog[ch], a + i * BEAT * 2, BEAT * 3, gain=0.12, cutoff=2600, attack=0.4)
            for i, mm in enumerate([74, 77, 81, 79, 77, 81, 86]):
                m.add(fm_bell(note(mm), idx(2.0), ratio=3.0, index=1.4, decay=1.1) * 0.07, a + i * BEAT / 2, p=(i - 3) * 0.15)
            m.add(kick(f0=80, f1=32, d=0.9) * 0.6, a)
        elif part == "finale":
            for i, ch in enumerate(["Dm", "Bb", "F", "Dadd9"]):
                pad(prog[ch], a + i * BEAT * 2, BEAT * (2 if i < 3 else 8), gain=0.1, cutoff=1600 + i * 400, attack=0.3)
            for k, x in beats(a, a + BEAT * 6):
                m.add(kick(f0=70, f1=30, d=0.45) * 0.4, x)
            for i, mm in enumerate([62, 69, 74, 76, 81]):
                m.add(fm_bell(note(mm), idx(4.0), ratio=2.0, index=1.0, decay=2.6) * 0.06, a + BEAT * 6 + i * 0.12, p=(i - 2) * 0.3)
    return m


# ------------------------------------------------------------------------------------------ sfx

def build_sfx():
    s = Bus()
    for c in CUES["sfx"]:
        at, k = t_of(c["f"]), c["k"]
        L = c.get("len", 30) / FPS
        if k == "tick":
            n = idx(0.12)
            x = bp(noise(n), 2500, 6000) * env(n, 0.0003, 0.008) + metal(n, 3100, 0.03) * 0.3
            s.add(x * 0.5, at, p=0.2)
        elif k == "riser":
            n = idx(L)
            t = np.arange(n) / SR
            r = (t / L) ** 2
            sweep = noise(n)
            # time-varying band: crossfade three bands for a rising whoosh
            x = bp(sweep, 300, 1200) * (1 - r) + bp(sweep, 1200, 5000) * r
            tone = np.sin(2 * np.pi * np.cumsum(120 + 900 * r) / SR) * 0.25
            s.add((x * 0.12 + tone * 0.12) * r, at)
        elif k in ("boom", "cut"):
            n = idx(3.0)
            x = kick(n, f0=60, f1=26, d=1.2) * 0.9 + lp(noise(n), 300) * env(n, 0.001, 0.25) * 0.4
            s.add(x * (0.8 if k == "boom" else 0.6), at)
        elif k == "bolt":
            i = c.get("n", 0)
            n = idx(1.6)
            latch = bp(noise(n), 1800, 7000) * env(n, 0.0005, 0.012) * 0.6 + metal(n, 900 + i * 40, 0.12) * 0.25
            ping = fm_bell(note([74, 77, 79, 81, 84, 86, 89, 91][i]), n, ratio=1.0, index=0.6, decay=0.7) * 0.18
            a = (i / 8) * 2 * math.pi
            s.add(latch + ping, at, p=math.sin(a) * 0.7)
        elif k == "impact":
            n = idx(3.5)
            x = kick(n, f0=90, f1=30, d=0.8) + metal(n, 160, 1.6, bright=0.6) * 0.5 + lp(noise(n), 2000) * env(n, 0.001, 0.05)
            s.add(x * 0.7, at)
        elif k == "whoosh":
            n = idx(0.9)
            t = np.arange(n) / SR
            e = np.sin(np.pi * np.clip(t / 0.9, 0, 1)) ** 2
            x = bp(noise(n), 400, 3500) * e * 0.25
            st = np.stack([x * np.linspace(1, 0.2, n), x * np.linspace(0.2, 1, n)])
            s.add(st, at - 0.35)
        elif k == "arrive":
            i = c.get("n", 0)
            n = idx(2.4)
            x = metal(n, 220 + i * 30, 0.9, bright=0.7) * 0.25 + fm_bell(note([50, 53, 57, 60, 62][i] + 12), n, 1.0, 0.8, 1.4) * 0.15
            s.add(x, at, p=-0.6 + i * 0.3)
        elif k == "type":
            x = at
            end = at + L
            while x < end:
                n = idx(0.05)
                y = bp(noise(n), 2000, 8000) * env(n, 0.0003, 0.006) * (0.12 + rng.random() * 0.08)
                s.add(y, x, p=(rng.random() - 0.5) * 0.4)
                x += 0.045 + rng.random() * 0.07
        elif k == "blip":
            n = idx(0.25)
            t = np.arange(n) / SR
            f = 1400 + 500 * np.exp(-t / 0.02)
            x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.05)
            s.add(x * 0.09, at, p=-0.3)
        elif k == "alarm":
            n = idx(1.4)
            t = np.arange(n) / SR
            x = (np.sin(2 * np.pi * 220 * t) + 0.5 * np.sin(2 * np.pi * 233 * t)) * env(n, 0.05, 0.6)
            x += lp(noise(n), 500) * env(n, 0.02, 0.4) * 0.4
            s.add(x * 0.16, at)
        elif k == "clunk":
            n = idx(1.4)
            v = rng.random()
            x = kick(n, f0=110 + v * 20, f1=55, d=0.12) * 0.8 + metal(n, 300 + v * 80, 0.35, bright=0.8) * 0.45 + bp(noise(n), 800, 5000) * env(n, 0.0005, 0.02) * 0.6
            s.add(x * 0.55, at, p=(v - 0.5) * 0.8)
        elif k == "creak":
            n = idx(L + 0.8)
            t = np.arange(n) / SR
            wob = 1 + 0.3 * np.sin(2 * np.pi * 0.7 * t)
            x = bp(noise(n), 120, 600) * 0.5
            res = np.sin(2 * np.pi * np.cumsum(70 * wob) / SR) * 0.4
            e = np.clip(t / 0.3, 0, 1) * np.clip((L + 0.8 - t) / 0.8, 0, 1)
            s.add((x + res) * e * 0.35, at, p=-0.2)
        elif k == "gold":
            n = idx(5.0)
            x = np.zeros(n)
            for i, mm in enumerate([86, 89, 93, 98, 101]):
                x += fm_bell(note(mm), n, 1.0, 0.5, 2.8) * (0.12 / (1 + i * 0.3))
            air = hp(noise(n), 6000) * np.clip(np.arange(n) / SR / 0.6, 0, 1) * np.exp(-np.arange(n) / SR / 1.8) * 0.06
            s.add(x + air, at)
        elif k == "counter":
            x = at
            k2 = 0
            while x < at + L:
                n = idx(0.06)
                y = metal(n, 2400 + (k2 % 5) * 120, 0.04) * 0.15
                s.add(y, x, p=0.2)
                k2 += 1
                x += max(0.03, 0.12 - k2 * 0.006)
        elif k == "slam":
            n = idx(5.0)
            x = kick(n, f0=120, f1=24, d=1.6) * 1.1
            x += metal(n, 140, 2.4, bright=0.5) * 0.6 + metal(n, 610, 1.2) * 0.25
            x += lp(noise(n), 4000) * env(n, 0.0005, 0.04) * 1.0
            s.add(x * 0.9, at)
        elif k == "coin":
            for j in range(3):
                n = idx(1.2)
                y = metal(n, 2900 + j * 210, 0.5, partials=(1, 1.48, 2.32, 3.1)) * 0.12
                s.add(y, at + j * 0.07, p=(j - 1) * 0.4)
        elif k == "pour":
            x = at
            while x < at + L:
                n = idx(0.08)
                y = metal(n, 2600 + rng.random() * 1800, 0.05, partials=(1, 1.5, 2.3)) * 0.05 * rng.random()
                s.add(y, x, p=(rng.random() - 0.5) * 0.6)
                x += 0.012 + rng.random() * 0.03
        elif k == "clock":
            x = at
            k2 = 0
            while x < at + L:
                prog = (x - at) / L
                n = idx(0.05)
                y = bp(noise(n), 3000, 9000) * env(n, 0.0003, 0.006) * 0.25 + metal(n, 2000 if k2 % 2 else 2600, 0.02) * 0.1
                s.add(y, x, p=0.25 if k2 % 2 else -0.25)
                k2 += 1
                x += 0.5 * (1 - prog) ** 2 + 0.045
        elif k == "shimmer":
            for i, mm in enumerate([93, 98, 100, 105]):
                s.add(fm_bell(note(mm), idx(3.0), 1.0, 0.4, 1.6) * 0.07, at + i * 0.09, p=(i - 1.5) * 0.4)
        elif k == "logo":
            n = idx(5.0)
            x = kick(n, f0=70, f1=30, d=1.4) * 0.7 + fm_bell(note(86), n, 2.0, 1.0, 3.0) * 0.12 + fm_bell(note(93), n, 2.0, 0.8, 3.0) * 0.08
            s.add(x, at)
    return s


# ------------------------------------------------------------------------------------------ space and master

def reverb(x, seconds=2.8, wet=0.25, tone=5000):
    n = idx(seconds)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = noise(n) * np.exp(-t / (seconds / 6.5))
        ir = lp(ir, tone)
        ir[: idx(0.012)] = 0  # pre-delay
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        out[ch] = fftconvolve(x[ch], ir)[: x.shape[1]]
    return x + out * wet


def compress(x, thresh_db=-16, ratio=3.0, attack=0.005, release=0.15):
    lvl = np.abs(x).max(axis=0)
    a, r = math.exp(-1 / (attack * SR)), math.exp(-1 / (release * SR))
    envv = np.zeros_like(lvl)
    e = 0.0
    # a simple peak follower, vectorised in blocks for speed
    blk = 64
    for i in range(0, len(lvl), blk):
        m = lvl[i : i + blk].max()
        e = a * e + (1 - a) * m if m > e else r * e + (1 - r) * m
        envv[i : i + blk] = e
    db = 20 * np.log10(envv + 1e-9)
    over = np.maximum(0, db - thresh_db)
    gain = 10 ** (-(over - over / ratio) / 20)
    return x * gain


def load(name):
    """A mono 48 kHz WAV from audio/eleven (ElevenLabs voice lines and sound effects)."""
    path = os.path.join(HERE, "eleven", name + ".wav")
    if not os.path.exists(path):
        return None
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return x


def load_vo(name):
    path = os.path.join(HERE, "vo", name + ".wav")
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768


def build_voice():
    """
    Three voices, each with its own colour, levelled by loudness rather than peak:
      n*  the narrator: warm, full range, centred
      d*  the guard AI: clean and bright, with a faint 14 ms double for a synthetic sheen
      a*  the rogue AI: a narrower band and a little grit, a touch left of centre
    """
    v = Bus()
    for c in CUES.get("vo", []):
        x = load_vo(c["file"])
        kind = c["file"][0]
        if kind == "n":
            x = hp(x, 70)
            target, p = 0.11, 0.0
        elif kind == "d":
            x = hp(x, 140)
            d = idx(0.014)
            x = x + np.concatenate([np.zeros(d), x[:-d]]) * 0.28
            target, p = 0.095, 0.12
        else:
            x = bp(x, 170, 7500)
            x = np.tanh(x * 3.0) / np.tanh(3.0)
            target, p = 0.09, -0.12
        rms = np.sqrt(np.mean(x[np.abs(x) > 0.01] ** 2)) + 1e-9
        x = x * (target / rms)
        x = np.clip(x, -0.98, 0.98)
        v.add(x, t_of(c["f"]), p=p)
    return v


def build_eleven(s):
    """ElevenLabs sound effects layered onto the synthesized ones at the same frames."""
    for c in CUES.get("eleven", []):
        x = load(c["file"])
        if x is None:
            continue
        x = x / (np.abs(x).max() + 1e-9)
        s.add(x * c.get("gain", 0.6), t_of(c["f"]))


def write(path, x):
    x = np.clip(x, -1, 1)
    pcm = (x.T * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    out = os.path.join(HERE, "stems")
    os.makedirs(out, exist_ok=True)
    music = reverb(build_music().y, 3.2, 0.32, 4500)
    sfx_bus = build_sfx()
    build_eleven(sfx_bus)
    sfx = reverb(sfx_bus.y, 2.4, 0.22, 7000)
    voice = reverb(build_voice().y, 0.9, 0.12, 6000)
    music = hp(music, 28)
    sfx = hp(sfx, 25)
    # duck the music under the big hits (sidechain from the sfx bus)
    side = lp(np.abs(sfx).max(axis=0), 8)
    # a look-ahead gate from the voice bus: the bed starts to dip 80 ms before a line and stays
    # down through it, so every word sits clearly on top (phone speakers included)
    from scipy.ndimage import maximum_filter1d
    on = (lp(np.abs(voice).max(axis=0), 20) > 0.004).astype(np.float64)
    win = idx(0.36)
    vs = maximum_filter1d(on, size=win, origin=-(win // 2) + idx(0.12))  # opens 0.24 s early, holds 0.12 s
    vs = lp(vs, 6)
    duck_m = (1 - np.clip(side * 1.2, 0, 0.5)) * (1 - 0.88 * vs)
    duck_s = 1 - 0.95 * vs
    mix = music * duck_m * 0.85 + sfx * duck_s + voice * 1.7
    # the held breath before the slam: everything drops away for a moment
    for seg in CUES["music"]:
        if seg["part"] == "silence":
            a, b = t_of(seg["from"]), t_of(seg["to"]) - 0.01
            t = np.arange(N) / SR
            gate = 1 - 0.94 * np.clip((t - (a - 0.12)) / 0.12, 0, 1) * np.clip((b - t) / 0.02, 0, 1)
            mix = mix * gate
    mix = compress(mix, -14, 2.5)
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)  # gentle soft clip
    peak = np.abs(mix).max()
    mix = mix / peak * 0.89
    write(os.path.join(out, "music.wav"), music / max(1e-9, np.abs(music).max()) * 0.89)
    write(os.path.join(out, "sfx.wav"), sfx / max(1e-9, np.abs(sfx).max()) * 0.89)
    write(os.path.join(out, "mix.wav"), mix)
    print("wrote", out, f"{DUR:.2f}s")
