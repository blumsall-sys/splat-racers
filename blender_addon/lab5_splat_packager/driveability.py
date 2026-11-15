"""Read-only track curvature/grade diagnostics; does not alter Blender geometry."""
import math

def analyze_samples(samples,width=5.0):
    """Samples are [(world_xyz, tilt_radians)] sampled along a cyclic curve."""
    if len(samples)<8: raise ValueError('Need at least eight curve samples')
    max_grade=0.0; max_bank=0.0; minimum_radius=float('inf')
    length=0.0; steep=0; tight=0
    n=len(samples)
    for i, (p,tilt) in enumerate(samples):
        prev=samples[(i-1)%n][0]; nxt=samples[(i+1)%n][0]
        dx=float(nxt.x-prev.x);dy=float(nxt.y-prev.y);dz=float(nxt.z-prev.z)
        h=math.hypot(dx,dy)
        grade=abs(dz)/max(.0001,h)
        max_grade=max(max_grade,grade);steep+=grade>.40
        max_bank=max(max_bank,abs(float(tilt)))
        q=samples[(i+1)%n][0];length+=float((q-p).length)
        a=p-prev;b=nxt-p
        if a.length>.0001 and b.length>.0001:
            ca=max(-1.,min(1.,a.normalized().dot(b.normalized())))
            angle=math.acos(ca)
            radius=(a.length+b.length)*.5/max(angle,1e-5)
            minimum_radius=min(minimum_radius,radius)
            tight+=radius<max(3.,width*.65)
    return dict(length_m=length,grade=max_grade,bank_degrees=math.degrees(max_bank),
                tightest_radius_m=minimum_radius,steep_samples=steep,tight_samples=tight,
                warnings=[msg for cond,msg in [
                  (max_grade>.40,'Grade exceeds 40%; slow chassis may scrape or stall'),
                  (max_bank>math.radians(30),'Bank exceeds 30 degrees; possible tip/edge snag'),
                  (minimum_radius<max(3.,width*.65),'Some bends are too tight for the 2.2m chassis')
                ] if cond])
