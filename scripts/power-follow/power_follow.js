// Shelly Power Strip Gen4 - power-follow script
// Master slot above threshold -> slave slots ON. At or below threshold -> slave slots OFF.
// Includes on/off delays, minimum on-time, startup delay, periodic re-check and error handling.

// ---------- CONFIG ----------
let CONFIG = {
  MASTER_SLOT: 1,          // slot to monitor (1-4)
  SLAVE_SLOTS: [2, 3],     // slots to switch (1-4)
  THRESHOLD_W: 10,         // ON when power > this, OFF when power <= this

  ON_DELAY_S: 3,           // power must stay above threshold this long before slaves switch on (0 = immediately)
  OFF_DELAY_S: 30,         // power must stay at/below threshold this long before slaves switch off (0 = immediately)
  MIN_ON_TIME_S: 60,       // slaves stay on at least this long once switched on (0 = disabled)

  STARTUP_DELAY_S: 2,      // wait after script start before doing anything
  RECHECK_S: 60,           // periodic re-check interval (0 = disabled)
  ENFORCE_STATE: true,     // re-check also corrects slaves that were toggled manually / failed to switch

  DEBUG: false             // verbose logging
};
// ----------------------------

let masterId = CONFIG.MASTER_SLOT - 1;   // slot 1 = switch:0
let slaveIds = [];
for (let i = 0; i < CONFIG.SLAVE_SLOTS.length; i++) {
  slaveIds.push(CONFIG.SLAVE_SLOTS[i] - 1);
}

let desired = null;      // state the script wants the slaves in (null = not decided yet)
let onSince = 0;         // uptime (ms) when slaves were last switched on
let onTimer = null;
let offTimer = null;
let recheckTimer = null;

function dbg(msg) {
  if (CONFIG.DEBUG) print("[DBG]", msg);
}

function validConfig() {
  if (CONFIG.MASTER_SLOT < 1 || CONFIG.MASTER_SLOT > 4) return false;
  if (CONFIG.SLAVE_SLOTS.length === 0) return false;
  for (let i = 0; i < CONFIG.SLAVE_SLOTS.length; i++) {
    let s = CONFIG.SLAVE_SLOTS[i];
    if (s < 1 || s > 4 || s === CONFIG.MASTER_SLOT) return false;
  }
  return true;
}

function setSwitch(id, on) {
  Shelly.call("Switch.Set", { id: id, on: on }, function (res, err, msg, ud) {
    if (err !== 0) {
      print("ERROR: Switch.Set slot", ud + 1, "failed:", err, msg, "- will retry on next re-check");
    } else {
      dbg("Switch.Set slot " + (ud + 1) + " -> " + (on ? "ON" : "OFF"));
    }
  }, id);
}

function applySlaves(on) {
  desired = on;
  if (on) onSince = Shelly.getUptimeMs();
  print("Slots", JSON.stringify(CONFIG.SLAVE_SLOTS), on ? "ON" : "OFF");
  for (let i = 0; i < slaveIds.length; i++) {
    setSwitch(slaveIds[i], on);
  }
}

function cancelOn() {
  if (onTimer !== null) { Timer.clear(onTimer); onTimer = null; }
}

function cancelOff() {
  if (offTimer !== null) { Timer.clear(offTimer); offTimer = null; }
}

function evaluate(power) {
  dbg("evaluate power=" + power + "W desired=" + desired);
  if (power > CONFIG.THRESHOLD_W) {
    cancelOff();
    if (desired === true) return;
    if (onTimer !== null) return;
    if (CONFIG.ON_DELAY_S <= 0) {
      applySlaves(true);
    } else {
      dbg("on-delay started");
      onTimer = Timer.set(CONFIG.ON_DELAY_S * 1000, false, function () {
        onTimer = null;
        applySlaves(true);
      });
    }
  } else {
    cancelOn();
    if (desired === false) return;
    if (desired === null) { applySlaves(false); return; }   // first decision after start
    if (offTimer !== null) return;

    let delay = CONFIG.OFF_DELAY_S * 1000;
    if (CONFIG.MIN_ON_TIME_S > 0) {
      let remaining = CONFIG.MIN_ON_TIME_S * 1000 - (Shelly.getUptimeMs() - onSince);
      if (remaining > delay) delay = remaining;
    }
    if (delay <= 0) {
      applySlaves(false);
    } else {
      dbg("off-delay started: " + Math.round(delay / 1000) + "s");
      offTimer = Timer.set(delay, false, function () {
        offTimer = null;
        applySlaves(false);
      });
    }
  }
}

function enforceSlave(id) {
  Shelly.call("Switch.GetStatus", { id: id }, function (res, err, msg, ud) {
    if (err !== 0 || !res) {
      print("ERROR: Switch.GetStatus slot", ud + 1, "failed:", err, msg);
      return;
    }
    if (desired !== null && res.output !== desired) {
      print("Re-check: slot", ud + 1, "was", res.output ? "ON" : "OFF", "- correcting to", desired ? "ON" : "OFF");
      setSwitch(ud, desired);
    }
  }, id);
}

function recheck() {
  Shelly.call("Switch.GetStatus", { id: masterId }, function (res, err, msg) {
    if (err !== 0 || !res) {
      print("ERROR: Switch.GetStatus master failed:", err, msg);
      return;
    }
    try {
      evaluate(typeof res.apower === "number" ? res.apower : 0);
      if (CONFIG.ENFORCE_STATE) {
        for (let i = 0; i < slaveIds.length; i++) {
          enforceSlave(slaveIds[i]);
        }
      }
    } catch (e) {
      print("ERROR in recheck:", e);
    }
  });
}

function onStatus(status) {
  try {
    if (status.component !== "switch:" + masterId) return;
    if (typeof status.delta.apower !== "number") return;
    evaluate(status.delta.apower);
  } catch (e) {
    print("ERROR in status handler:", e);
  }
}

function start() {
  Shelly.addStatusHandler(onStatus);
  recheck();   // initial evaluation
  if (CONFIG.RECHECK_S > 0) {
    recheckTimer = Timer.set(CONFIG.RECHECK_S * 1000, true, recheck);
  }
  print("power-follow started: master slot", CONFIG.MASTER_SLOT,
        "slaves", JSON.stringify(CONFIG.SLAVE_SLOTS),
        "threshold", CONFIG.THRESHOLD_W, "W");
}

if (!validConfig()) {
  print("ERROR: invalid CONFIG (slots must be 1-4, at least one slave, master must not be a slave). Script not started.");
} else {
  Timer.set(CONFIG.STARTUP_DELAY_S * 1000, false, start);
}
