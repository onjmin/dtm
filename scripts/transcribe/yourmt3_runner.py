#!/usr/bin/env python
"""
YourMT3+（多楽器採譜、https://huggingface.co/spaces/mimbres/YourMT3）で音声を採譜し、音符を JSON に書く。
依存（transformers 4.45 等）がグローバル環境とぶつかるので **専用 venv の python で呼ぶ**。transcribe_audio.py が子プロセスで呼ぶ。

    <venv>/python scripts/transcribe/yourmt3_runner.py --ymt3 <space の clone> --out notes.json a.wav [b.wav ...]

出力は {入力パス: [[開始秒, 終了秒, 音高, program, is_drum], ...]}。program 100=歌、101=コーラス、ドラムは 128。
準備は docs/transcription-eval.md の「v3」を参照。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

CHECKPOINT = "mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt"  # YPTF.MoE+Multi (noPS)
ARGS = [
    CHECKPOINT, "-p", "2024", "-tk", "mc13_full_plus_256", "-dec", "multi-t5", "-nl", "26", "-enc", "perceiver-tf",
    "-sqr", "1", "-ff", "moe", "-wf", "4", "-nmoe", "8", "-kmoe", "2", "-act", "silu", "-epe", "rope", "-rp", "1",
    "-ac", "spec", "-hop", "300", "-atc", "1", "-pr", "16",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", nargs="+")
    ap.add_argument("--ymt3", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    audios = [str(Path(p).resolve()) for p in a.audio]
    out = Path(a.out).resolve()

    os.chdir(a.ymt3)  # チェックポイントは space 直下からの相対パス（amt/logs/...）で引かれる
    sys.path.insert(0, str(Path(a.ymt3) / "amt" / "src"))
    sys.path.insert(0, str(Path(a.ymt3)))
    import torch
    import torchaudio
    from model_helper import load_model_checkpoint
    from utils.audio import slice_padded_array
    from utils.event2note import merge_zipped_note_events_and_ties_to_notes
    from utils.note2event import mix_notes

    model = load_model_checkpoint(args=ARGS, device="cpu").to("cuda")
    res = json.load(open(out, encoding="utf-8")) if out.exists() else {}  # 途中で落ちても続きから
    for path in audios:
        if path in res:
            continue
        audio, sr = torchaudio.load(path)
        audio = torchaudio.functional.resample(audio.mean(0, keepdim=True), sr, model.audio_cfg["sample_rate"])
        n_in = model.audio_cfg["input_frames"]
        segs = torch.from_numpy(slice_padded_array(audio, n_in, n_in).astype("float32")).to("cuda").unsqueeze(1)
        with torch.no_grad():
            tokens, _ = model.inference_file(bsz=8, audio_segments=segs)
        starts = [n_in * i / model.audio_cfg["sample_rate"] for i in range(segs.shape[0])]
        per_ch = []
        for ch in range(model.task_manager.num_decoding_channels):
            zipped, _, _ = model.task_manager.detokenize_list_batches([t[:, ch, :] for t in tokens], starts, return_events=True)
            notes, _ = merge_zipped_note_events_and_ties_to_notes(zipped)
            per_ch.append(notes)
        notes = mix_notes(per_ch)
        res[path] = sorted(
            [float(n.onset), float(n.offset), int(n.pitch), 128 if n.is_drum else int(n.program), bool(n.is_drum)] for n in notes
        )
        json.dump(res, open(out, "w", encoding="utf-8"))
        print(f"{Path(path).name}: {len(notes)} notes", flush=True)


if __name__ == "__main__":
    main()
