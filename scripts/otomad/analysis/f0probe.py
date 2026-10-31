import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402
import librosa, numpy as np, pyworld
Y = str(paths.MATERIAL / "淫夢/淫夢SPパック_分割⑤/第４章「昏睡レイプ！野獣と化した先輩」/野獣")
for n in ['おまたせ', 'これもうわかんねぇな', 'アアッ！アッ！', '大丈夫でしょ']:
    y, sr = librosa.load(Y + '/野獣「' + n + '」.wav', sr=16000)
    f0, t = pyworld.harvest(y.astype(np.float64), sr, f0_floor=60, f0_ceil=700, frame_period=10)
    v = f0[f0 > 0]
    print(n, round(len(y) / sr, 2), 'voiced', round((f0 > 0).mean(), 2), 'med', round(float(np.median(v)), 1) if len(v) else None,
          np.round(12 * np.log2(v[::5] / 440) + 69).astype(int)[:30] if len(v) else '')
    f1, vf, _ = librosa.pyin(y, fmin=60, fmax=700, sr=sr, hop_length=160, frame_length=2048)
    print('  pyin2048', round(float(vf.mean()), 2), 'max', float(np.abs(y).max()))
