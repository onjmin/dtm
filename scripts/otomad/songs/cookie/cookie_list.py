"""クッキー☆の 7z をすべて一覧し、wav を話者ごとに書き出す（使い捨て）。

python -I cookie_list.py            … 一覧
python -I cookie_list.py x 話者…    … 指定の話者の 7z を cookie_src/ へ展開
"""
import collections
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

SEVEN = r"C:\Program Files\7-Zip\7z.exe"
R = next((paths.MATERIAL / "クッキー☆").rglob("UDK姉貴.7z")).parent
OUT = paths.WORK / "cookie_src"

if len(sys.argv) > 2 and sys.argv[1] == "x":
    for name in sys.argv[2:]:
        r = subprocess.run([SEVEN, "x", "-y", f"-o{OUT}", str(R / f"{name}.7z")], capture_output=True)
        print(name, "ok" if r.returncode == 0 else r.stderr.decode("cp932", "replace")[:200])
    sys.exit()

rows = []
for f in sorted(R.glob("*.7z")):
    r = subprocess.run([SEVEN, "l", "-ba", "-sccUTF-8", str(f)], capture_output=True)
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        if line.lower().endswith(".wav"):
            rows.append(line[53:])
c = collections.Counter(w.split("\\")[0] for w in rows)
print(len(rows))
print(c.most_common())
open(paths.WORK / "cookie_wavs.txt", "w", encoding="utf-8").write("\n".join(rows))
