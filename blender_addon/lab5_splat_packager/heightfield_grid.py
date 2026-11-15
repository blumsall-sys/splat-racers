"""Pure adaptive resolution selection for the OPTIONAL legacy browser heightfield.

The PlayCanvas/Ammo racing backend uses the static collision GLB instead.
"""
import math


def choose_grid(span_x, span_y, requested_step, max_cells=25000):
    """Return (actual_spacing, width, depth) guaranteed not to exceed max_cells.

    Preserve the original requested spacing for small tracks. Larger tracks
    are sampled more coarsely without silently changing the world-space bounds.
    """
    for value in (span_x, span_y, requested_step):
        if not math.isfinite(value):
            raise ValueError('Heightfield bounds or cell spacing are not finite')
    if requested_step <= 0 or span_x < 0 or span_y < 0 or max_cells < 4:
        raise ValueError('Invalid heightfield bounds, spacing or cell limit')
    def dimensions(step):
        return (max(2, math.ceil(span_x / step) + 1),
                max(2, math.ceil(span_y / step) + 1))
    width, depth = dimensions(requested_step)
    if width * depth <= max_cells:
        return requested_step, width, depth
    # A coarse initial guess, followed by small monotonic refinements because
    # ceiling-to-grid and endpoint cells cause rounding overhead.
    step = requested_step * math.sqrt((width * depth) / max_cells)
    for _ in range(100):
        width, depth = dimensions(step)
        if width * depth <= max_cells:
            return step, width, depth
        step *= 1.02
    raise RuntimeError('Could not fit heightfield into the configured cell limit')
