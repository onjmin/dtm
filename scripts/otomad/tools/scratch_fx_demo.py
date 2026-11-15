"""界隈曲に Scratch 文字PV の演出（lib/scratch_fx.py）を当てる見本。曲のフォルダ（tmp/songs/…）の notes.json・song.mml と master.wav から組む。

  python -I scripts/otomad/tools/scratch_fx_demo.py <曲のフォルダ> <master.wav> [--bars 20 46] [--shots 24 32.1 33 40]
    → tmp/scratch_fx_demo/<曲名>.mp4（--shots のときは同じ場所へ確認用の静止画）

決まり:
- 箱の格子はドラムの打点（master の打楽器成分の立ち上がりを8分の格子で読む）。1小節 = 1列。
- サビ（marks の C で始まる区間）の頭で枠が回ってパーン、格子が下へ組み替わる。サビの歌は1音1字で枠の中へ散らし、
  2小節ごとに消し、縦書きでも右に積む。サビの最後の1小節で字が崩れ落ちる。
- サビ以外の歌は下の1行字幕。歌詞は song.mml の @@n 行（1字1モーラで音符と同数、の曲だけ使える）。
"""
import argparse, json, os, re, subprocess, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'otomad', 'lib'))
import scratch_fx as fx
from venc import venc

FPS = 30


def load_song(song_dir):
    n = json.load(open(os.path.join(song_dir, 'notes.json'), encoding='utf8'))
    bar_sec = 60 / n['BPM'] * 4
    tick = bar_sec / n['BAR']
    marks = []
    for m in n['marks']:
        name, b = m.rsplit(' ', 1)
        marks.append((name, int(b)))
    mml = open(os.path.join(song_dir, 'song.mml'), encoding='utf8').read()
    words = []  # [(時刻, 終わり, 語, [各字の時刻])]
    for m in re.finditer(r'^@@(\d+) (.*?);?$', mml, re.M):
        tr = m.group(1)
        toks = [w for w in m.group(2).split() if re.fullmatch(r'[ぁ-んァ-ヶー]+', w)]
        notes = sorted(n['tracks'].get(tr, []), key=lambda x: x['start'])
        chars = ''.join(toks)
        if len(chars) != len(notes):
            print(f'track {tr}: 字 {len(chars)} と音符 {len(notes)} が合わないので飛ばす', file=sys.stderr)
            continue
        i = 0
        for w in toks:
            ns = notes[i:i + len(w)]; i += len(w)
            words.append((ns[0]['start'] * tick, (ns[-1]['start'] + ns[-1]['dur']) * tick, w, [x['start'] * tick for x in ns]))
    words.sort()
    return bar_sec, marks, words, n['TOTAL']


def drum_hits(wav, bar_sec, b0, b1, rows=8):
    import librosa
    y, sr = librosa.load(wav, sr=22050, mono=True)
    _, perc = librosa.effects.hpss(y)
    env = librosa.onset.onset_strength(y=perc, sr=sr, hop_length=256)
    times = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=256)
    step = bar_sec / rows
    hits = []
    for b in range(b0, b1):
        vals = []
        for s in range(rows):
            t = b * bar_sec + s * step
            sel = (times > t - 0.03) & (times < t + 0.03)
            vals.append(env[sel].max() if sel.any() else 0)
        vals = np.array(vals); top = vals.max() or 1
        for s, v in enumerate(vals):
            r = v / top
            if r < 0.6:
                continue
            kind = 'fill' if r > 0.8 else 'check' if s % 4 == 2 else 'cross' if r > 0.55 else 'dots'
            hits.append(fx.Hit(b * bar_sec + s * step, b, s, kind))
    return hits


def build(song_dir, wav, b0, b1):
    bar_sec, marks, words, total = load_song(song_dir)
    T = lambda b: b * bar_sec
    st = fx.Stage()
    rng = np.random.default_rng(7)
    chorus = []  # [(始め, 終わり)] 秒
    for i, (name, b) in enumerate(marks):
        if name.startswith('C') or name.startswith('Last'):
            e = marks[i + 1][1] if i + 1 < len(marks) else total
            chorus.append((T(b), T(e)))
    in_ch = lambda t: any(a <= t < e for a, e in chorus)
    win = [(a, e) for a, e in chorus if T(b0) <= a < T(b1)]

    grid = fx.StepGrid(st, drum_hits(wav, bar_sec, b0, b1), appear=T(b0) + 0.1,
                       morphs=[m for a, e in win for m in ((a, 'h'), (e - bar_sec, 'v'))])
    frame = fx.FramePop(st, pops=[a for a, e in win], fill=[x for a, e in win for x in ((a, (215, 215, 215)), (e - bar_sec, None))],
                        appear=T(b0) + 0.1)

    glyphs, vlines, clears, cam_keys, falls = [], [], [], [], []
    dirs = [0, 90, 180, -90, 45, -45, 135, -135]
    for a, e in win:
        for k, b in enumerate(np.arange(a, e - bar_sec / 2, bar_sec)):
            cam_keys.append((b, 0, 0, (20 if k % 2 else -12) * (k % 3 != 2), 1.15 if k % 2 else 0.9))
        cam_keys.append((e - bar_sec, 0, 0, 0, 1.0))
        falls.append(e - bar_sec)
    for t0, t1, w, ts in words:
        if not in_ch(t0) or not (T(b0) <= t0 < T(b1)) or any(f - 0.05 <= t0 < f + bar_sec for f in falls):
            continue
        vlines.append((t0, w))
        clears.append(t0 - 0.01)  # 語ごとに枠の中を入れ替える
        # 語の字を枠の中の格子へ。置いた所から滑って、格子の位置で止まるよう出発点を逆算する
        n = len(w); cols = min(3, n) if n <= 6 else 3 if n <= 9 else 4
        rows = -(-n // cols); cell = 112 / max(cols, rows)
        for j, (ch, t) in enumerate(zip(w, ts)):
            r, c = divmod(j, cols)
            fx_, fy = (c - (cols - 1) / 2) * cell + rng.uniform(-4, 4), 20 - (r - (rows - 1) / 2) * cell + rng.uniform(-4, 4)
            d = float(rng.choice(dirs)); sp = rng.uniform(5, 10); L = fx.drift_total(sp)
            th = np.radians(d)
            glyphs.append(fx.Glyph(t, ch, fx_ - L * np.sin(th), fy - L * np.cos(th), size=cell / 40 * 100 * 0.9,
                                   angle=90 + float(rng.choice([0, 0, 0, 0, 15, -15, 90])), move_dir=d, speed=sp))
    scatter = fx.ScatterText(st, glyphs, camera=fx.camera_keys(cam_keys), clip_to=frame, clears=clears,
                             fall_at=falls[0] if falls else None)
    vert = fx.VerticalLyrics(st, vlines, clears=[e for a, e in win])
    subs = fx.Subtitle(st, [(t0, t1 + 0.25, w) for t0, t1, w, _ in words if not in_ch(t0)])

    def frame_at(t):
        cv = st.new()
        grid.draw(cv, t)
        frame.draw_back(cv, t)
        scatter.draw(cv, t)
        frame.draw_front(cv, t)
        vert.draw(cv, t)
        subs.draw(cv, t)
        return np.asarray(cv.convert('RGB'))
    return frame_at, bar_sec


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('song'); ap.add_argument('wav')
    ap.add_argument('--bars', nargs=2, type=int, default=[20, 50])
    ap.add_argument('--shots', nargs='*', type=float)
    a = ap.parse_args()
    name = os.path.basename(a.song.rstrip('/\\')).split(' - ')[-1]
    out_dir = os.path.join(REPO, 'tmp', 'scratch_fx_demo'); os.makedirs(out_dir, exist_ok=True)
    frame_at, bar_sec = build(a.song, a.wav, *a.bars)
    from PIL import Image
    if a.shots is not None:
        for b in a.shots:
            Image.fromarray(frame_at(b * bar_sec)).resize((960, 540)).save(os.path.join(out_dir, f'shot_{b:06.2f}.png'))
        print('shots', out_dir); return
    t0, t1 = a.bars[0] * bar_sec, a.bars[1] * bar_sec
    out = os.path.join(out_dir, f'{name}.mp4')
    ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-r', str(FPS), '-i', '-',
                           '-ss', f'{t0:.3f}', '-t', f'{t1 - t0:.3f}', '-i', a.wav, *venc(20), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
                           '-shortest', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    n = int((t1 - t0) * FPS)
    for i in range(n):
        ff.stdin.write(frame_at(t0 + i / FPS).tobytes())
        if i % 300 == 0:
            print(f'{i}/{n}', flush=True)
    ff.stdin.close(); ff.wait()
    print('done', out, ff.returncode)


if __name__ == '__main__':
    main()
