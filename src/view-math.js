export function orbitSpeed(distance) { return Math.max(.05,Math.min(.6,.36*(distance-1)/2.8)); }
// Analytic ray/sphere intersection; no per-frame geometry raycasts.
export function sphereBlocksRay(origin, target, center, radius) {
  const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z;
  const length=Math.hypot(dx,dy,dz); if (!length) return false;
  const x=center.x-origin.x,y=center.y-origin.y,z=center.z-origin.z;
  const along=(x*dx+y*dy+z*dz)/length;
  if(along<=0 || along>=length) return false;
  return x*x+y*y+z*z-along*along < radius*radius;
}
