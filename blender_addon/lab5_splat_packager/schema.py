"""Pure helpers: can run and be tested outside Blender."""
import math, os, re, json

def clean_id(value):
    cleaned=re.sub(r'[^a-zA-Z0-9_-]+','-',str(value)).strip('-_').lower()
    if not cleaned or len(cleaned)>64: raise ValueError('Asset ID must contain 1-64 safe characters')
    return cleaned

def browser_point(p):
    return {'x':round(float(p.x),5),'z':round(-float(p.y),5)}

def browser_yaw(angle):
    # Blender +Z yaw, and browser +Z-forward with x right and browser z=-Blender Y.
    return round(float(angle),6)

def check_track(t):
    if t.get('version')!=1:raise ValueError('track.version must be 1')
    if any(k not in t.get('spawns',{}) for k in ('p1','p2')):raise ValueError('Missing p1/p2 spawn')
    free=t.get('levelType')=='FREE_ROAM'
    if not free and len(t.get('race',{}).get('waypoints',[]))<8:raise ValueError('Need 8+ ordered waypoints')
    if not free and len(t.get('race',{}).get('gates',[]))<3:raise ValueError('Need START and at least 2 gates')
    if not free and len(t.get('collision',{}).get('walls',[]))<4:raise ValueError('Need 4+ collision walls for prototype')
    return t

def expected_outputs():
    return ('track.json','asset-pack.json')
