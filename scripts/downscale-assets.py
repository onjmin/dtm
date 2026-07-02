"""
assets/*.png を 384×384 → 32×32 (÷12 等倍) にダウンスケールする。
・ニアレストネイバー法でドット絵のシャープさを保持
・既に 32×32 なら何もしない（冪等）
"""

from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).parent.parent / "assets"
TARGET = (32, 32)

for png in sorted(ASSETS.glob("*.png")):
    with Image.open(png) as img:
        if img.size == TARGET:
            print(f"skip  {png.name} (already {TARGET[0]}x{TARGET[1]})")
            continue
        w, h = img.size
        if w % TARGET[0] != 0 or h % TARGET[1] != 0:
            print(f"WARN  {png.name}: {w}x{h} は {TARGET[0]}x{TARGET[1]} の整数倍でない → スキップ")
            continue
        resized = img.resize(TARGET, Image.NEAREST)
        resized.save(png, optimize=True)
        print(f"done  {png.name}: {w}x{h} → {TARGET[0]}x{TARGET[1]}")
