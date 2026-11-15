"""界隈曲に Scratch 文字PV の演出（lib/scratch_fx.py）を当てる見本。曲のフォルダ（tmp/songs/…）の notes.json・song.mml と master.wav から組む。

  python -I scripts/otomad/tools/scratch_fx_demo.py <曲のフォルダ> <master.wav> [--bars 20 46] [--shots 24 32.1 33 40] [--parts left,bottom,center,subs]
    → tmp/scratch_fx_demo/<曲名>.mp4（--shots のときは同じ場所へ確認用の静止画）

決まり:
- 箱の盤は1拍1箱（縦8行で2小節）。キックとスネアは song.mml の #drum の固定パターン（src/instruments/drum-config.ts）から読む。
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


def drum_pattern(song_dir):
    """song.mml の #drum=<名前> を src/instruments/drum-config.ts から引き、[(step, 'kick'|'snare')] と1周の長さを返す。
    dtm のドラムは名前つきの固定パターンなので、ミックスから読むより確か（ミックスの帯域ではスネアが歌に埋もれた）。"""
    mml = open(os.path.join(song_dir, 'song.mml'), encoding='utf8').read()
    m = re.search(r'#drum=(\w+)', mml)
    if not m or m.group(1) == 'none':
        return [], 192
    src = open(os.path.join(REPO, 'src', 'instruments', 'drum-config.ts'), encoding='utf8').read()
    i = src.find(f'\t{m.group(1)}: {{')
    if i < 0:
        return [], 192
    block = src[i:src.index('],', i)]
    hits = []
    for st, key in re.findall(r'step: (\d+), pitch: DRUM_KEYS\.(\w+)', block):
        kind = 'kick' if 'bassDrum' in key else 'snare' if ('Snare' in key or 'Clap' in key) else None
        if kind:
            hits.append((int(st), kind))
    top = max([s_ for s_, _ in hits], default=0)
    return hits, 192 * (top // 192 + 1)


def drum_beats(song_dir, bar_sec, b0, b1, in_chorus):
    """1拍ごとの Beat。拍の頭（4分の位置）にキック・スネアがあれば点ける。
    2小節の最後の拍のキックは accent、サビのスネアは snare2（手本の規則）。"""
    hits, length = drum_pattern(song_dir)
    beat = bar_sec / 4
    beats = []
    for i in range((b1 - b0) * 4):
        t = b0 * bar_sec + i * beat
        pos = (b0 * 192 + i * 48) % length
        kinds = {k for s_, k in hits if s_ == pos}
        beats.append(fx.Beat(t, ('accent' if i % 8 == 7 else 'kick') if 'kick' in kinds else None,
                             ('snare2' if in_chorus(t) else 'snare') if 'snare' in kinds else None))
    return beats


def build(song_dir, wav, b0, b1, parts=('left', 'bottom', 'center', 'subs')):
    """左の盤・下の盤・真ん中の文字PV・字幕を別々に作って重ねる。parts で要るものだけ選べる"""
    bar_sec, marks, words, total = load_song(song_dir)
    T = lambda b: b * bar_sec
    st = fx.Stage()
    chorus = []  # [(始め, 終わり)] 秒
    for i, (name, b) in enumerate(marks):
        if name.startswith('C') or name.startswith('Last'):
            e = marks[i + 1][1] if i + 1 < len(marks) else total
            chorus.append((T(b), T(e)))
    in_ch = lambda t: any(a <= t < e for a, e in chorus)
    win = [(a, e) for a, e in chorus if T(b0) <= a < T(b1)]
    # サビの間は下、それ以外（とサビの最後の1小節）は左
    bottom_spans = [(a, e - bar_sec) for a, e in win]
    left_spans, cur = [], T(b0)
    for a, e in bottom_spans:
        left_spans.append((cur, a)); cur = e
    left_spans.append((cur, None))

    beats = drum_beats(song_dir, bar_sec, b0, b1, in_ch)
    left = fx.BeatColumn(st, beats, spans=left_spans)
    bottom = fx.BeatRow(st, beats, spans=bottom_spans, enter_from=left)
    left.enter_from = bottom if bottom_spans else None   # サビ明けは下から左へ戻る
    left.spans = left_spans
    center = fx.LyricPV(st, [w for w in words if T(b0) <= w[0] < T(b1)], win, bar=bar_sec, frame_spans=[(T(b0), None)])
    subs = fx.Subtitle(st, [(t0, t1 + 0.25, w) for t0, t1, w, _ in words if not in_ch(t0)])
    table = {'left': left, 'bottom': bottom, 'center': center, 'subs': subs}
    layers = [table[p] for p in parts]
    return (lambda t: fx.compose(st, layers, t)), bar_sec


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('song'); ap.add_argument('wav')
    ap.add_argument('--bars', nargs=2, type=int, default=[20, 50])
    ap.add_argument('--shots', nargs='*', type=float)
    ap.add_argument('--parts', default='left,bottom,center,subs', help='重ねる部品（left,bottom,center,subs から）')
    a = ap.parse_args()
    name = os.path.basename(a.song.rstrip('/\\')).split(' - ')[-1]
    out_dir = os.path.join(REPO, 'tmp', 'scratch_fx_demo'); os.makedirs(out_dir, exist_ok=True)
    frame_at, bar_sec = build(a.song, a.wav, *a.bars, parts=a.parts.split(','))
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
