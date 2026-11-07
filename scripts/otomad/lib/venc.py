"""動画の符号器の ffmpeg 引数。標準はグラボ（NVENC）。CPU の libx264 は 4K で律速になった（2026-11-07）。

VIDEO_ENC=x264 か、ffmpeg に h264_nvenc が無い PC では libx264 に戻す。q は libx264 の crf と同じ目安の値。
"""

from __future__ import annotations

import functools
import os
import subprocess


@functools.cache
def has_nvenc() -> bool:
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, errors="replace").stdout
    except OSError:
        return False
    return "h264_nvenc" in out


def venc(q: int = 20) -> list[str]:
    if os.environ.get("VIDEO_ENC") == "x264" or not has_nvenc():
        return ["-c:v", "libx264", "-preset", "medium", "-crf", str(q)]
    return ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", str(q), "-b:v", "0"]
