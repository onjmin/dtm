import json,sys,numpy as np,soundfile as sf
od=sys.argv[1]; x,sr=sf.read(od+"/song.wav"); x=x.mean(1)
info=json.load(open(od+"/placement.json",encoding="utf-8")); bar=240/info["bpm"]; h=info["head"]
for s in info["sections"]:
    a=int((h+(s["from"]-1)*bar)*sr); b=int((h+s["to"]*bar)*sr); seg=x[a:b]
    print(f'{s["name"]:7s} bars {s["from"]:2d}-{s["to"]:2d} rms {20*np.log10(np.sqrt((seg**2).mean())+1e-9):6.1f} dB')
