// .traef — a clip's events (the file beside each .tranm): when the game plays a
// sound, a voice line or sets a trigger during the clip, and on which joint.
//
// Layout (FlatBuffers, no schema — worked out from the files):
//   root [0]  vector of Event
//   Event [1] type: 'Audio/PostEvent', 'Audio/PokeVoiceEvent', 'System/SetTriggerParameter', …
//         [2] start frame, [3] end frame (u32)
//         [4] vector of Param
//   Param [0] name: 'EventName', 'JointName', 'ParameterName', 'Follow', 'Probability', …
//         [1] value kind (u32; its low byte: 0x04 text, 0x01 whole number, 0x03 true/false)
//         [2] table holding the value at its field 0
//
// Seen so far: 'Audio/PostEvent' plays EventName (PLAY_PM_COMMON_WHOOSH_M: the
// swing's whoosh; PLAY_PM_FOOTCONTACT_*: a footfall) following JointName; the
// whoosh is often on the limb that strikes (Blaziken's swipe: left_hand),
// often on the waist. 'System/SetTriggerParameter' with ParameterName
// 'Pokemon_EffectStart' marks where the move's effect starts: the blow. No
// particles: these only time and place sounds and triggers.

import { openFb } from './fb.js';

/**
 * @returns {{ events: Array<{ type: string, start: number, end: number, params: Record<string, string|number|boolean> }> }}
 */
export function readTraef(bytes) {
  const f = openFb(bytes);
  const r = f.root;
  const events = [];
  const list = r ? f.fvec(r, 0) : null;
  if (!list) return { events };
  for (let e = 0; e < list.n; e++) {
    const ev = f.ent(list, e);
    if (!ev) continue;
    const type = f.fstr(ev, 1);
    if (!type) continue;
    const params = {};
    const pv = f.fvec(ev, 4);
    if (pv) for (let p = 0; p < pv.n; p++) {
      const pt = f.ent(pv, p);
      const name = f.fstr(pt, 0);
      if (!name) continue;
      const kind = f.fint(pt, 1) & 0xff;
      const holder = pt.fields[2] ? f.table(pt.fields[2] + f.u32(pt.fields[2])) : null;
      if (!holder || !holder.fields[0]) continue;
      params[name] = kind === 0x04 ? f.fstr(holder, 0)
        : kind === 0x03 ? f.u8(holder.fields[0]) !== 0
          : f.fint(holder, 0);
    }
    events.push({ type, start: f.fint(ev, 2), end: f.fint(ev, 3), params });
  }
  return { events };
}

/** The frame a clip's effect starts (its blow), if its events say: the Pokemon_EffectStart trigger. */
export function effectStart(events) {
  const e = events && events.find((x) => x.type === 'System/SetTriggerParameter' && x.params.ParameterName === 'Pokemon_EffectStart');
  return e ? e.start : null;
}

/** The joint its swing's whoosh follows, if it has one (Audio/PostEvent, PLAY_PM_COMMON_WHOOSH_*). */
export function whooshJoint(events) {
  const e = events && events.find((x) => x.type === 'Audio/PostEvent' && /WHOOSH/.test(String(x.params.EventName || '')) && x.params.JointName);
  return e ? String(e.params.JointName) : null;
}
