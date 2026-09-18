"""旋律の並び順を学習する（小さな GPT）。

    python tools/melody-model/train.py --data tmp/dataset.jsonl --out tmp/melody-model.pt

## 大きさについて

界隈曲91本は**トークン 99,238 個**しかない。言語モデルの常識からすると極小で、
ゼロから学習させれば一般化ではなく**暗記**になる。暗記したモデルが出すのは
コーパスのフレーズの近似コピーで、それは `src/compose-phrases.ts`（実在した2小節を
そのまま持つバンク）とほぼ同じものにしかならない。

だからこのスクリプトは**2段階**で使う。

1. `--data` に大きなコーパス（Lakh MIDI など）を与えて事前学習する
2. `--init <事前学習の .pt>` を付けて、界隈曲91本で微調整する

91本だけで回すこともできるが、それは**配線の検算**のためであって、品質のためではない。
"""

from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

import tokenizer as tk


class Block(nn.Module):
    def __init__(self, dim: int, heads: int, drop: float):
        super().__init__()
        self.ln1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, heads, dropout=drop, batch_first=True)
        self.ln2 = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(
            nn.Linear(dim, 4 * dim), nn.GELU(), nn.Linear(4 * dim, dim), nn.Dropout(drop)
        )

    def forward(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        h = self.ln1(x)
        a, _ = self.attn(h, h, h, attn_mask=mask, need_weights=False)
        x = x + a
        return x + self.mlp(self.ln2(x))


class MelodyGPT(nn.Module):
    """素の decoder-only Transformer。**小さく保つ**——データが少ないので、
    容量を増やしても暗記が速くなるだけ。"""

    def __init__(
        self, vocab: int, ctx: int, dim: int = 256, heads: int = 4, layers: int = 4,
        drop: float = 0.1,
    ):
        super().__init__()
        self.ctx = ctx
        self.tok = nn.Embedding(vocab, dim)
        self.pos = nn.Embedding(ctx, dim)
        self.drop = nn.Dropout(drop)
        self.blocks = nn.ModuleList([Block(dim, heads, drop) for _ in range(layers)])
        self.ln = nn.LayerNorm(dim)
        self.head = nn.Linear(dim, vocab, bias=False)
        self.head.weight = self.tok.weight  # 重み共有。パラメータを減らす

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        t = idx.size(1)
        pos = torch.arange(t, device=idx.device)
        x = self.drop(self.tok(idx) + self.pos(pos))
        mask = torch.triu(
            torch.full((t, t), float("-inf"), device=idx.device), diagonal=1
        )
        for b in self.blocks:
            x = b(x, mask)
        return self.head(self.ln(x))


def make_stream(data: str) -> list[int]:
    """全曲を1本の列に繋ぐ。曲の境目は BOS/EOS が持っている。"""
    songs = tk.load_songs(data)
    stream: list[int] = []
    for s in songs:
        stream.extend(tk.encode(s))
    return stream


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="tmp/dataset.jsonl")
    ap.add_argument("--out", default="tmp/melody-model.pt")
    ap.add_argument("--init", default=None, help="事前学習した .pt から始める")
    ap.add_argument("--ctx", type=int, default=512)
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    dev = "cuda" if torch.cuda.is_available() else "cpu"

    stream = make_stream(args.data)
    # **検証用を曲単位ではなく末尾で切る。** 曲単位に分けるには曲数が少なすぎる
    # （91本では検証側が数本になり、損失がその数本の癖に振り回される）。
    split = int(len(stream) * 0.9)
    train, val = stream[:split], stream[split:]
    print(f"トークン {len(stream)} (学習 {len(train)} / 検証 {len(val)})")
    if len(train) < args.ctx * 2:
        raise SystemExit("データが窓より短い。--ctx を下げるかデータを増やすこと")

    model = MelodyGPT(len(tk.VOCAB), args.ctx).to(dev)
    if args.init:
        model.load_state_dict(torch.load(args.init, map_location=dev))
        print(f"事前学習から再開: {args.init}")
    n_params = sum(p.numel() for p in model.parameters())
    print(f"パラメータ {n_params / 1e6:.2f}M / device={dev}")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.steps)

    def batch(src: list[int]) -> tuple[torch.Tensor, torch.Tensor]:
        ix = [random.randrange(len(src) - args.ctx - 1) for _ in range(args.batch)]
        x = torch.tensor([src[i : i + args.ctx] for i in ix], device=dev)
        y = torch.tensor([src[i + 1 : i + 1 + args.ctx] for i in ix], device=dev)
        return x, y

    @torch.no_grad()
    def val_loss() -> float:
        model.eval()
        total = 0.0
        for _ in range(20):
            x, y = batch(val)
            total += F.cross_entropy(
                model(x).view(-1, len(tk.VOCAB)), y.reshape(-1)
            ).item()
        model.train()
        return total / 20

    best = math.inf
    for step in range(1, args.steps + 1):
        x, y = batch(train)
        loss = F.cross_entropy(model(x).view(-1, len(tk.VOCAB)), y.reshape(-1))
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 250 == 0 or step == args.steps:
            v = val_loss()
            flag = ""
            if v < best:
                best = v
                Path(args.out).parent.mkdir(parents=True, exist_ok=True)
                torch.save(model.state_dict(), args.out)
                flag = " ←保存"
            print(f"  step {step:5d}  学習 {loss.item():.3f}  検証 {v:.3f}{flag}")

    print(f"● 最良の検証損失 {best:.3f} → {args.out}")
    print("  学習損失だけ下がって検証損失が上がり始めたら、そこから先は暗記。")


if __name__ == "__main__":
    main()
