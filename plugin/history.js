// Undo for a tab's settings: note() after every change keeps the state from before it, so undo() can go back.
// Changes less than 0.7 s apart (a slider drag, typing) make one step; up to 100 steps.
// o: state() → the current state as a string; restore(state); onAvail(canUndo) (to enable the Undo button).
"use strict";

function makeHistory(o) {
  const steps = [];
  let now = null, t = 0;
  return {
    note() {
      const s = o.state();
      if (now === null || s === now) { now = s; return; }
      const tt = Date.now();
      if (tt - t > 700 || !steps.length) { steps.push(now); if (steps.length > 100) steps.shift(); }
      t = tt; now = s;
      o.onAvail(true);
    },
    undo() {
      if (!steps.length) return false;
      o.restore(steps.pop());
      now = o.state(); t = 0;
      o.onAvail(steps.length > 0);
      return true;
    },
    canUndo: () => steps.length > 0,
  };
}

if (typeof module !== "undefined") module.exports = { makeHistory };
