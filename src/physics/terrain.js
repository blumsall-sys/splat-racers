export function roadHeight(x,z) {
  // broad, low tabletop speed bump on lower straight
  const sx=Math.max(0,1-Math.abs(x-6.8)/1.55);
  const sz=Math.max(0,1-Math.abs(z+8.25)/2.65);
  return 0.28 * sx*sx*(3-2*sx) * sz*sz*(3-2*sz);
}
