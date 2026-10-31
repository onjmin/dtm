import sys, time, runpy
import numpy as np
sys.argv = ['x', 'techno1']
gn = runpy.run_path('scratch_techno/techno1_video_np.py', run_name='mod')
gg = runpy.run_path('techno1_video.py', run_name='mod')
for sec in (20, 50, 85, 115, 130):
    a = gn['frame_at'](sec * 30).astype(np.float32); b = gg['frame_at'](sec * 30).astype(np.float32)
    print(sec, 'mean abs diff', round(float(np.abs(a - b).mean()), 2), 'p99', round(float(np.percentile(np.abs(a - b), 99)), 1))
for name, g in (('numpy', gn), ('torch', gg)):
    g['frame_at'](1500)
    t = time.time()
    for f in list(range(1500, 1520)) + list(range(3900, 3920)):
        g['frame_at'](f)
    print(name, 'per frame', round((time.time() - t) / 40, 4))
