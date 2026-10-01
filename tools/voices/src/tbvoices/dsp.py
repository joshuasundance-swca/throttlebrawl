"""Audio clean-up for barks: mono, resample, high-pass, trim, cut-offs, loudness and Opus.

Loudness is ITU-R BS.1770 integrated loudness (K-weighting, 400 ms blocks, the -70 LUFS absolute
and -10 LU relative gates), so every rival sits at the same level whatever the model gave back.
"""

from __future__ import annotations

import io
from fractions import Fraction
from pathlib import Path

import numpy as np
import numpy.typing as npt
import soundfile as sf
from scipy import ndimage, signal

Audio = npt.NDArray[np.float64]
SR = 24_000
OPUS_RATES = (8000, 12000, 16000, 24000, 48000)


def read_audio(data: bytes) -> tuple[Audio, int]:
    """Decodes WAV/OGG/FLAC bytes to mono float64."""
    x, sr = sf.read(io.BytesIO(data), always_2d=True, dtype="float64")
    return np.asarray(x.mean(axis=1), dtype=np.float64), int(sr)


def resample(x: Audio, sr_from: int, sr_to: int) -> Audio:
    if sr_from == sr_to:
        return x
    f = Fraction(sr_to, sr_from).limit_denominator(1000)
    return np.asarray(signal.resample_poly(x, f.numerator, f.denominator), dtype=np.float64)


def pitch_shift(x: Audio, semis: float) -> Audio:
    """Shifts pitch and formants together (a bigger or smaller speaker); the length changes too."""
    if semis == 0:
        return x
    ratio = Fraction(2 ** (-semis / 12)).limit_denominator(200)
    return np.asarray(signal.resample_poly(x, ratio.numerator, ratio.denominator), dtype=np.float64)


def highpass(x: Audio, sr: int, hz: float = 80.0) -> Audio:
    sos = signal.butter(2, hz, btype="highpass", fs=sr, output="sos")
    return np.asarray(signal.sosfiltfilt(sos, x), dtype=np.float64)


def frame_db(x: Audio, sr: int, frame_s: float = 0.01) -> Audio:
    n = max(1, int(frame_s * sr))
    frames = len(x) // n
    if frames == 0:
        return np.array([-120.0])
    rms = np.sqrt(np.mean(np.square(x[: frames * n].reshape(frames, n)), axis=1) + 1e-20)
    return np.asarray(20 * np.log10(rms), dtype=np.float64)


def voiced_bounds(x: Audio, sr: int, below_peak_db: float = 40.0, floor_db: float = -60.0) -> tuple[int, int]:
    """First and last sample of sound louder than `below_peak_db` under the loudest 10 ms frame."""
    db = frame_db(x, sr)
    thr = max(float(db.max()) - below_peak_db, floor_db)
    on = np.nonzero(db > thr)[0]
    if len(on) == 0:
        return 0, len(x)
    n = int(0.01 * sr)
    return int(on[0]) * n, min(len(x), (int(on[-1]) + 1) * n)


def fade(x: Audio, sr: int, in_s: float, out_s: float) -> Audio:
    y = x.copy()
    a, b = min(len(y), int(in_s * sr)), min(len(y), int(out_s * sr))
    if a:
        y[:a] *= np.linspace(0, 1, a)
    if b:
        y[len(y) - b :] *= np.linspace(1, 0, b)
    return y


def trim(x: Audio, sr: int, pre_s: float = 0.03, post_s: float = 0.1, below_peak_db: float = 40.0) -> Audio:
    """Drops leading and trailing silence, keeping a short pad, with tiny fades."""
    a, b = voiced_bounds(x, sr, below_peak_db)
    a = max(0, a - int(pre_s * sr))
    b = min(len(x), b + int(post_s * sr))
    return fade(x[a:b], sr, 0.008, 0.03)


def cut_tail(x: Audio, sr: int, seconds: float) -> Audio:
    """Breaks the last word off: removes `seconds` of the voiced end, with a 10 ms fade."""
    _, b = voiced_bounds(x, sr)
    end = max(int(0.05 * sr), b - int(seconds * sr))
    return fade(x[:end], sr, 0.0, 0.01)


def silence(sr: int, seconds: float) -> Audio:
    return np.zeros(max(0, int(seconds * sr)), dtype=np.float64)


# ---- Loudness (BS.1770) ----------------------------------------------------------------------


def _k_weighting(sr: int) -> npt.NDArray[np.float64]:
    """The K-weighting pre-filter as second-order sections (a high shelf, then a high-pass)."""

    def shelf(fc: float, gain_db: float, q: float) -> list[float]:
        a = 10 ** (gain_db / 40)
        w = 2 * np.pi * fc / sr
        alpha = np.sin(w) / (2 * q)
        c = np.cos(w)
        b0 = a * ((a + 1) + (a - 1) * c + 2 * np.sqrt(a) * alpha)
        b1 = -2 * a * ((a - 1) + (a + 1) * c)
        b2 = a * ((a + 1) + (a - 1) * c - 2 * np.sqrt(a) * alpha)
        a0 = (a + 1) - (a - 1) * c + 2 * np.sqrt(a) * alpha
        a1 = 2 * ((a - 1) - (a + 1) * c)
        a2 = (a + 1) - (a - 1) * c - 2 * np.sqrt(a) * alpha
        return [b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]

    def hp(fc: float, q: float) -> list[float]:
        w = 2 * np.pi * fc / sr
        alpha = np.sin(w) / (2 * q)
        c = np.cos(w)
        a0 = 1 + alpha
        return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, 1.0, -2 * c / a0, (1 - alpha) / a0]

    return np.array([shelf(1681.97, 4.0, 0.7072), hp(38.13, 0.5003)], dtype=np.float64)


def loudness_lufs(x: Audio, sr: int) -> float:
    """Integrated loudness in LUFS (mono). Clips shorter than a block use one block."""
    y = signal.sosfilt(_k_weighting(sr), x)
    block, hop = int(0.4 * sr), int(0.1 * sr)
    if len(y) < block:
        ms = np.array([float(np.mean(np.square(y)))])
    else:
        starts = range(0, len(y) - block + 1, hop)
        ms = np.array([float(np.mean(np.square(y[s : s + block]))) for s in starts])
    lk = -0.691 + 10 * np.log10(ms + 1e-20)
    gated = ms[lk > -70]
    if len(gated) == 0:
        return -120.0
    rel = -0.691 + 10 * np.log10(float(np.mean(gated))) - 10
    gated = ms[(lk > -70) & (lk > rel)]
    return float(-0.691 + 10 * np.log10(float(np.mean(gated)) + 1e-20))


def true_peak_db(x: Audio) -> float:
    """Peak of the 4x oversampled signal, in dBFS."""
    up = signal.resample_poly(x, 4, 1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-20))


def limit(x: Audio, sr: int, ceiling_db: float) -> Audio:
    """A simple look-ahead peak limiter: 5 ms hold, 80 ms release, never above the ceiling."""
    ceiling = 10 ** (ceiling_db / 20)
    hold = max(1, int(0.005 * sr))
    env = ndimage.maximum_filter1d(np.abs(x), size=2 * hold + 1)
    gain = np.minimum(1.0, ceiling / np.maximum(env, 1e-12))
    # Smooth the release (gain may only recover slowly), keeping the attack instant.
    rel = np.exp(-1.0 / (0.08 * sr))
    g = gain.copy()
    for i in range(1, len(g)):
        g[i] = min(gain[i], rel * g[i - 1] + (1 - rel) * gain[i])
    y = x * g
    return np.asarray(np.clip(y, -ceiling, ceiling), dtype=np.float64)


def normalize(x: Audio, sr: int, target_lufs: float, peak_db: float) -> Audio:
    """Gain to the target loudness, then the limiter catches any peak over the ceiling."""
    now = loudness_lufs(x, sr)
    y = x * 10 ** ((target_lufs - now) / 20) if now > -100 else x
    # Leave a little room for the codec's overshoot and the 4x peak.
    return limit(y, sr, peak_db - 0.5)


# ---- Encoding ----------------------------------------------------------------------------------


def opus_level(kbps: int) -> float:
    """libsndfile's Opus 'compression level' maps linearly onto about 6..256 kbps."""
    return float(min(1.0, max(0.0, 1 - (kbps * 1000 - 6000) / 250_000)))


def encode_opus(x: Audio, sr: int, kbps: int) -> bytes:
    if sr not in OPUS_RATES:
        x, sr = resample(x, sr, SR), SR
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1, 1), sr, format="OGG", subtype="OPUS", compression_level=opus_level(kbps))
    return buf.getvalue()


def write_wav(path: Path, x: Audio, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.clip(x, -1, 1), sr, subtype="PCM_16")


def read_wav(path: Path) -> tuple[Audio, int]:
    return read_audio(path.read_bytes())
