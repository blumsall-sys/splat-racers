"""Pure helpers for adaptive Bezier mesh density and safe guardrail proxies."""
import math

def recommended_spline_resolution(segment_length, spacing=.50):
    if segment_length < 0 or spacing <= 0:raise ValueError('Bad segment length/spacing')
    return max(24,min(192, math.ceil(segment_length/spacing)))

def wall_segment_count(total_length, spacing=.60):
    if not math.isfinite(total_length) or total_length<=0 or spacing<=0:raise ValueError('Invalid track length')
    return max(64,min(800,math.ceil(total_length/spacing)))

def make_wall_segment(start,end,height,thickness,up_a,up_b):
    """Blender coordinate space (X, Y, Z), browser X=x, Z=-y, height=z.
    Wall bottoms straddle the road normal; segment boxes are world-up with
    generous vertical range so modest banking does not create gaps.
    """
    delta=end-start
    horizontal=math.hypot(delta.x,delta.y)
    if horizontal<.015:return None
    # Include tilted endpoints and a little downward overlap at the deck.
    az=(start-.12*up_a).z;bz=(end-.12*up_b).z
    topa=(start+height*up_a).z;topb=(end+height*up_b).z
    low=min(az,bz)-.08;high=max(topa,topb)+.08
    return dict(x=round((start.x+end.x)/2,5),z=round(-(start.y+end.y)/2,5),
        hx=round(thickness/2,5),hz=round(horizontal/2+.025,5),
        yaw=round(math.atan2(delta.x,-delta.y),6),
        y=round((low+high)/2,5),height=round(high-low,5))
