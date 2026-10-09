export const STAND_PELVIS_Y = 1.994;
export const VERTICAL_TRACK_PATTERN = /^fml_un_C_pelvis_att\.position$/i;

// The MultiVersus clips store the pelvis height in two different references:
// grounded clips measure it from the floor (~1.99 when standing) while airborne
// clips measure it from the airborne capsule centre (~-0.1). Pelvis keys below
// this threshold belong to the airborne reference.
export const AIR_REFERENCE_MAX_Y = 0.6;

// Clips played while standing keep their authored pelvis height on the floor,
// so crouches (punch, laser, ice breath, leap wind-up) stay planted instead of
// floating. When the same clip is used in the air it is flattened instead.
export const HERO_GROUND_AUTHORED_CLIPS = new Set([
  'C003_Idle_01', 'C003_Run_01', 'C003_Punch_01', 'C003_N_Attack_01', 'C003_Laser_Ground',
  'C003_Laser_Ground_Start', 'C003_Laser_Ground_Loop', 'C003_Laser_Ground_Exit',
  'C003_IceBreath', 'C003_IceBreath_Loop', 'C003_IceBreath_IntoIdle',
  'C003_LeapAttack', 'C003_LeapAttackLand'
]);
// Clips that switch from the airborne to the floor reference mid-clip.
export const HERO_HYBRID_CLIPS = new Set(['C003_Land', 'C003_Jump_01']);
// Hover loops whose bobbing is worth keeping around the standing height.
export const HERO_CENTERED_CLIPS = new Set(['C003_S08_Emote_CharacterSelect_Loop']);

export function neutralizeVerticalTracks(tracks, constantY = STAND_PELVIS_Y) {
  return tracks.map(track => {
    if (VERTICAL_TRACK_PATTERN.test(track.name)) {
      const values = new Float32Array(track.values);
      for (let i = 1; i < values.length; i += 3) {
        values[i] = constantY;
      }
      return { ...track, values };
    }
    return track;
  });
}

export function heroClipVerticalMode(name, variant = 'air') {
  if (variant === 'ground' && HERO_GROUND_AUTHORED_CLIPS.has(name)) return 'authored';
  if (HERO_HYBRID_CLIPS.has(name)) return 'hybrid';
  if (HERO_CENTERED_CLIPS.has(name)) return 'centered';
  return 'neutral';
}

// Modes: 'authored' keeps the clip, 'neutral' pins the pelvis height,
// 'hybrid' pins only airborne-reference keys and 'centered' re-centres the
// clip's average height on the standing height while keeping its motion.
export function remapVerticalTracks(tracks, mode = 'neutral', constantY = STAND_PELVIS_Y) {
  if (mode === 'authored') return tracks;
  if (mode === 'neutral') return neutralizeVerticalTracks(tracks, constantY);
  return tracks.map(track => {
    if (!VERTICAL_TRACK_PATTERN.test(track.name)) return track;
    const values = new Float32Array(track.values);
    if (mode === 'hybrid') {
      for (let i = 1; i < values.length; i += 3) {
        if (values[i] < AIR_REFERENCE_MAX_Y) values[i] = constantY;
      }
    } else if (mode === 'centered') {
      let sum = 0;
      let count = 0;
      for (let i = 1; i < values.length; i += 3) { sum += values[i]; count++; }
      const shift = count ? constantY - sum / count : 0;
      for (let i = 1; i < values.length; i += 3) values[i] += shift;
    }
    return { ...track, values };
  });
}
