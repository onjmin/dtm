import subprocess,sys,numpy as np
p=sys.argv[1]
raw=subprocess.run(["ffmpeg","-v","error","-i",p,"-vf","fps=4,scale=64:48","-f","rawvideo","-pix_fmt","rgb24","-"],capture_output=True).stdout
v=np.frombuffer(raw,np.uint8).reshape(-1,48,64,3).astype(np.float32)
a=subprocess.run(["ffmpeg","-v","error","-i",p,"-ac","1","-ar","8000","-f","f32le","-"],capture_output=True).stdout
x=np.frombuffer(a,np.float32)
for s in range(0,int(len(v)/4),6):
    f=v[s*4:(s+6)*4]; seg=x[s*8000:(s+6)*8000]
    print(f"{s:4d}s bright {f.mean():5.1f} sat {(f.max(-1)-f.min(-1)).mean():5.1f} motion {np.abs(np.diff(f,axis=0)).mean():5.1f}  rms {20*np.log10(np.sqrt((seg**2).mean())+1e-9):6.1f}")
