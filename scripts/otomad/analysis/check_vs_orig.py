"""カバーの伴奏を、区間ごとに原曲の伴奏と並べて確かめる（渡す前の確認。手順は OTOMAD_DOCS/techniques/match-original.md）。

python scripts/otomad/analysis/check_vs_orig.py --orig 原曲の歌なし.wav --ours 自分の伴奏.wav --bpm 130 \
    --sec "イントロ=0-8,A1=8-28,B=28-36" --map "0:17,44:25" [--shift 0.037] [--name a49]

- 小節番号は原曲の番号。--map「原曲の小節:自分の版で何小節うしろか」（その小節から先に効く）。--shift は原曲側の秒の補正。
- demucs（htdemucs_6s）で両方を分け（scratch/sep/ に置く）、区間ごとに 6 帯の割合・同時に鳴る音の数・和音−ドラム・ベース−ドラム を
  原曲との差で出す。±3 dB・±3 音を超えた所に ★。
- 区間ごとに原曲と上下に並べたスペクトログラム（同じ基準・同じ色の幅）を scratch/check/<名前>_<区間>.png に書く。必ず目で見る。"""
import argparse, os, sys, subprocess
import numpy as np, soundfile as sf, librosa, librosa.display
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

ap = argparse.ArgumentParser()
ap.add_argument('--orig', required=True); ap.add_argument('--ours', required=True)
ap.add_argument('--bpm', type=float, required=True); ap.add_argument('--sec', required=True)
ap.add_argument('--map', default='0:0'); ap.add_argument('--shift', type=float, default=0.0)
ap.add_argument('--name'); ap.add_argument('--sep', default='scratch/sep'); ap.add_argument('--out', default='scratch/check')
A = ap.parse_args()
BAR = 60 / A.bpm * 4; FS = 44100
SEC = {k: tuple(float(x) for x in v.split('-')) for k, v in (s.split('=') for s in A.sec.split(','))}
MAP = sorted((float(a), float(b)) for a, b in (m.split(':') for m in A.map.split(',')))
BANDS = ((40, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 16000))
STEMS = ('drums', 'bass', 'other', 'guitar', 'piano')
db = lambda x: 10 * np.log10(np.mean(x ** 2) + 1e-20)


def separate(wav, name):
    d = f'{A.sep}/htdemucs_6s/{name}'
    if not os.path.exists(f'{d}/other.wav') or os.path.getmtime(f'{d}/other.wav') < os.path.getmtime(wav):
        os.makedirs(f'{A.sep}/in', exist_ok=True)
        x, sr = sf.read(wav, always_2d=True); sf.write(f'{A.sep}/in/{name}.wav', x, sr)   # 名前をそろえて渡す
        subprocess.run([sys.executable, '-m', 'demucs', '-n', 'htdemucs_6s', '-o', A.sep, f'{A.sep}/in/{name}.wav'], check=True, capture_output=True)
    return d


def offset(a):
    return [b for s, b in MAP if s <= a][-1] if any(s <= a for s, _ in MAP) else 0.0


def rd(d, stem, a, b, ours):
    t0 = (a + offset(a)) * BAR if ours else a * BAR + A.shift
    return sf.read(f'{d}/{stem}.wav', start=int(t0 * FS), frames=int((b - a) * BAR * FS), always_2d=True)[0]


def stats(d, a, b, ours):
    st = {k: rd(d, k, a, b, ours) for k in STEMS}
    m = sum(st.values()).mean(1)
    X = np.abs(np.fft.rfft(m)) ** 2; f = np.fft.rfftfreq(len(m), 1 / FS); tot = X[(f > 40) & (f < 16000)].sum()
    bd = [10 * np.log10(X[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in BANDS]
    hm = (st['other'] + st['guitar'] + st['piano']).mean(1)
    C = np.abs(librosa.cqt(hm.astype(np.float32), sr=FS, hop_length=2048, fmin=librosa.note_to_hz('C3'), n_bins=37)) + 1e-9
    c = 20 * np.log10(C); notes = float(np.median((c > c.max(0) - 15).sum(0)))   # C3–C6 で、いちばん大きい音から 15 dB 以内の音の数
    return bd, notes, db(hm) - db(st['drums']), db(st['bass']) - db(st['drums']), m


name = A.name or os.path.splitext(os.path.basename(A.ours))[0].lower()
do, dm = separate(A.orig, 'orig'), separate(A.ours, name)
os.makedirs(A.out, exist_ok=True)
print(f'{"区間":6} {"40-250":>7} {"250-500":>7} {"500-1k":>7} {"1-2k":>7} {"2-4k":>7} {"4-16k":>7} {"音の数":>7} {"和音-ドラム":>9} {"ベース-ドラム":>9}   （原曲との差）')
bad = []
for s, (a, b) in SEC.items():
    o, m = stats(do, a, b, False), stats(dm, a, b, True)
    cells = [f'{y - x:+6.1f}{"★" if abs(y - x) > 3 else " "}' for x, y in zip(o[0], m[0])]
    cells.append(f'{m[1] - o[1]:+6.0f}{"★" if abs(m[1] - o[1]) > 3 else " "}')
    cells += [f'{m[i] - o[i]:+8.1f}{"★" if abs(m[i] - o[i]) > 3 else " "}' for i in (2, 3)]
    print(f'{s:6}', ' '.join(cells), f'  原曲の音の数 {o[1]:.0f}')
    if any('★' in c for c in cells): bad.append(s)
    ys = [y / (np.sqrt(np.mean(y ** 2)) + 1e-9) * .1 for y in (o[4], m[4])]          # 大きさをそろえ、2 枚を同じ基準で塗る
    Ss = [np.abs(librosa.stft(y.astype(np.float32), n_fft=4096, hop_length=1024)) for y in ys]
    REF = max(S.max() for S in Ss)
    fig, ax = plt.subplots(2, 1, figsize=(16, 7), sharex=True)
    for i, (lab, S) in enumerate(zip(('原曲', name), Ss)):
        librosa.display.specshow(librosa.amplitude_to_db(S, ref=REF), sr=FS, hop_length=1024, x_axis='time', y_axis='log',
                                 ax=ax[i], vmin=-75, vmax=0, cmap='magma')
        ax[i].set_ylim(40, 16000); ax[i].set_ylabel(lab, fontname='MS Gothic')
    plt.tight_layout(); plt.savefig(f'{A.out}/{name}_{s}.png', dpi=55); plt.close(fig)
print('★ のある区間:', '、'.join(bad) or 'なし', f'／ 図: {A.out}/')
