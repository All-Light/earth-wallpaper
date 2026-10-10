export const EARTH_HOME = Object.freeze({
  x: Math.cos(41.9028 * Math.PI / 180) * Math.cos(12.4964 * Math.PI / 180),
  y: Math.sin(41.9028 * Math.PI / 180),
  z: -Math.cos(41.9028 * Math.PI / 180) * Math.sin(12.4964 * Math.PI / 180),
});
export const OLD_NORTHERN_EUROPE_HOME = Object.freeze({
  x: Math.cos(60 * Math.PI / 180) * Math.cos(18 * Math.PI / 180),
  y: Math.sin(60 * Math.PI / 180),
  z: -Math.cos(60 * Math.PI / 180) * Math.sin(18 * Math.PI / 180),
});
export function directionFromLatLon(latitude, longitude) {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180, c = Math.cos(lat);
  return {x:c*Math.cos(lon),y:Math.sin(lat),z:-c*Math.sin(lon)};
}
export function normalizeDirection(value, fallback = EARTH_HOME) {
  if (!value || ![value.x,value.y,value.z].every(Number.isFinite)) return {...fallback};
  const length=Math.hypot(value.x,value.y,value.z);
  return length>0?{x:value.x/length,y:value.y/length,z:value.z/length}:{...fallback};
}
export function isOldDefaultDirection(value) {
  if (!value || ![value.x,value.y,value.z].every(Number.isFinite)) return false;
  const v=normalizeDirection(value), old=OLD_NORTHERN_EUROPE_HOME;
  return v.x*old.x+v.y*old.y+v.z*old.z > 1-1e-10;
}
export function migrateHomeDirection(value) {
  return isOldDefaultDirection(value) ? {...EARTH_HOME} : normalizeDirection(value);
}
export function migrateSavedView(state, home = EARTH_HOME) {
  if (!state || typeof state !== 'object') return state;
  const migrated={...state};
  if (isOldDefaultDirection(state.homeDirection)) migrated.homeDirection={...EARTH_HOME};
  else if (state.homeDirection) migrated.homeDirection=normalizeDirection(state.homeDirection);
  if (state.camera && [state.camera.x,state.camera.y,state.camera.z].every(Number.isFinite)) {
    const radius=Math.hypot(state.camera.x,state.camera.y,state.camera.z);
    if (radius>0 && isOldDefaultDirection(state.camera)) migrated.camera={x:EARTH_HOME.x*radius,y:EARTH_HOME.y*radius,z:EARTH_HOME.z*radius};
  }
  migrated.homeDirection ??= {...home};
  return migrated;
}
