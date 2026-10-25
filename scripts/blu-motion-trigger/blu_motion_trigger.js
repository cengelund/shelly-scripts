// Shelly BLU Motion trigger for the Shelly Power Strip Gen4 (any Gen2+ device with Bluetooth)
// A Shelly BLU Motion sensor switches one or more slots on this device, fully local (no cloud, no extra gateway).
//
// - Motion while it is dark       -> mapped slots ON
// - No motion (+ optional delay)  -> mapped slots OFF
//
// Bluetooth must be enabled on the device. Encrypted BLU sensors are not supported.

// ---------- CONFIG ----------
let CONFIG = {
  SENSORS: [
    {
      MAC: "00:00:00:00:00:00",   // lowercase MAC of the BLU Motion, replace this (see README for how to find it)
      NAME: "hallway",            // used in log messages
      SLOTS: [4],                 // slots (1-4) switched by this sensor

      LUX_DARK_BELOW: 50,         // dark when lux < this  (null = ignore light level)
      LUX_LIGHT_ABOVE: 60,        // bright when lux > this (keep >= LUX_DARK_BELOW, the gap is the hysteresis)
      OFF_DELAY_S: 60,            // extra time to keep slots on after "no motion" (0 = none). Comes on top of the sensor's own blind time
      MIN_RSSI: -85               // ignore motion packets weaker than this (null = accept all)
    }
    // add more sensors here, several sensors can share slots (a slot stays on while any of them is active)
  ],

  MANUAL_OVERRIDE_MIN: 10,        // after you toggle a controlled slot by hand, pause automation for this long (0 = disabled)
  OFFLINE_AFTER_MIN: 120,         // if a sensor is active but silent for this long, apply OFFLINE_ACTION (0 = disabled)
  OFFLINE_ACTION: "off",          // "off" = switch its slots off, "keep" = only log it
  OFF_AT_START: true,             // switch controlled slots off when the script starts (e.g. after a power cut)

  STARTUP_DELAY_S: 2,             // wait after script start before doing anything
  ACTIVE_SCAN: false,             // passive scanning saves sensor battery
  DEBUG: false                    // verbose logging (also prints MACs of unconfigured BTHome devices)
};
// ----------------------------

let sensors = [];
let slotUsed = [false, false, false, false];
let slotOn = [null, null, null, null];        // last known/commanded state, null = unknown
let overrideUntil = [0, 0, 0, 0];
let lastSetTs = [-100000, -100000, -100000, -100000];

function now() {
  return Shelly.getUptimeMs();
}

function dbg(msg) {
  if (CONFIG.DEBUG) print("[DBG]", msg);
}

function opt(o, k, d) {
  return (typeof o[k] === "undefined") ? d : o[k];
}

function validConfig() {
  if (!CONFIG.SENSORS || CONFIG.SENSORS.length === 0) return false;
  for (let i = 0; i < CONFIG.SENSORS.length; i++) {
    let c = CONFIG.SENSORS[i];
    if (typeof c.MAC !== "string" || c.MAC.length !== 17) return false;
    if (c.MAC === "00:00:00:00:00:00") {
      print("ERROR: set the real MAC address of your BLU Motion in CONFIG.SENSORS. Script not started.");
      return false;
    }
    if (!c.SLOTS || c.SLOTS.length === 0) return false;
    for (let j = 0; j < c.SLOTS.length; j++) {
      if (c.SLOTS[j] < 1 || c.SLOTS[j] > 4) return false;
    }
  }
  return true;
}

function initSensors() {
  for (let i = 0; i < CONFIG.SENSORS.length; i++) {
    let c = CONFIG.SENSORS[i];
    let ids = [];
    for (let j = 0; j < c.SLOTS.length; j++) {
      ids.push(c.SLOTS[j] - 1);
      slotUsed[c.SLOTS[j] - 1] = true;
    }
    sensors.push({
      cfg: c,
      name: opt(c, "NAME", c.MAC),
      slotIds: ids,
      active: false,
      dark: true,          // light level unknown counts as dark
      lastPid: -1,
      lastSeen: 0,
      offTimer: null,
      offline: false
    });
  }
}

function findSensor(addr) {
  for (let i = 0; i < sensors.length; i++) {
    if (sensors[i].cfg.MAC === addr) return sensors[i];
  }
  return null;
}

// ---------- BTHome v2 decoding (objects broadcast by BLU Motion) ----------
function parseBthome(buf) {
  if (buf.length < 2) return null;
  if (buf.at(0) & 0x01) {
    dbg("encrypted BTHome packet ignored");
    return null;
  }
  let res = {};
  let i = 1;
  while (i < buf.length) {
    let id = buf.at(i);
    i++;
    if (id === 0x00 && i + 1 <= buf.length) {           // packet id
      res.pid = buf.at(i); i += 1;
    } else if (id === 0x01 && i + 1 <= buf.length) {    // battery %
      res.battery = buf.at(i); i += 1;
    } else if (id === 0x05 && i + 3 <= buf.length) {    // illuminance, 0.01 lux
      res.lux = (buf.at(i) | (buf.at(i + 1) << 8) | (buf.at(i + 2) << 16)) * 0.01; i += 3;
    } else if (id === 0x21 && i + 1 <= buf.length) {    // motion
      res.motion = buf.at(i); i += 1;
    } else if (id === 0x3A && i + 1 <= buf.length) {    // button
      res.button = buf.at(i); i += 1;
    } else {
      dbg("unknown or truncated BTHome object " + id);
      break;
    }
  }
  return res;
}

// ---------- switching ----------
function setSwitch(id, on) {
  slotOn[id] = on;
  lastSetTs[id] = now();
  print("Slot", id + 1, on ? "ON" : "OFF");
  Shelly.call("Switch.Set", { id: id, on: on }, function (res, err, msg, ud) {
    if (err !== 0) {
      print("ERROR: Switch.Set slot", ud + 1, "failed:", err, msg, "- will retry on next event");
      slotOn[ud] = null;
    }
  }, id);
}

function applySlot(id, on) {
  if (slotOn[id] === on) return;
  if (now() < overrideUntil[id]) {
    dbg("slot " + (id + 1) + " in manual override, not switching");
    return;
  }
  setSwitch(id, on);
}

function sync() {
  for (let id = 0; id < 4; id++) {
    if (!slotUsed[id]) continue;
    let wanted = false;
    for (let i = 0; i < sensors.length; i++) {
      let s = sensors[i];
      for (let j = 0; j < s.slotIds.length; j++) {
        if (s.slotIds[j] === id && s.active) wanted = true;
      }
    }
    applySlot(id, wanted);
  }
}

// ---------- sensor logic ----------
function clearOff(s) {
  if (s.offTimer !== null) {
    Timer.clear(s.offTimer);
    s.offTimer = null;
  }
}

function startOff(s, delayS) {
  s.offTimer = Timer.set(delayS * 1000, false, function () {
    s.offTimer = null;
    s.active = false;
    print(s.name, "inactive");
    sync();
  });
}

function updateDark(s, lux) {
  let lo = opt(s.cfg, "LUX_DARK_BELOW", null);
  if (lo === null) return;
  let hi = opt(s.cfg, "LUX_LIGHT_ABOVE", lo);
  if (lux < lo) s.dark = true;
  else if (lux > hi) s.dark = false;
  dbg(s.name + " lux " + lux + " -> " + (s.dark ? "dark" : "bright"));
}

function onMotion(s) {
  clearOff(s);
  if (!s.active) {
    if (!s.dark) {
      dbg(s.name + " motion ignored, too bright");
      return;
    }
    s.active = true;
    print(s.name, "motion");
  }
  sync();
}

function onNoMotion(s) {
  if (!s.active) return;
  let delay = opt(s.cfg, "OFF_DELAY_S", 0);
  if (delay <= 0) {
    s.active = false;
    print(s.name, "no motion");
    sync();
  } else if (s.offTimer === null) {
    dbg(s.name + " no motion, off in " + delay + "s");
    startOff(s, delay);
  }
}

function handlePacket(s, d, rssi) {
  if (typeof d.pid === "number") {
    if (d.pid === s.lastPid) return;     // duplicate advertisement
    s.lastPid = d.pid;
  }
  s.lastSeen = now();
  if (s.offline) {
    s.offline = false;
    print(s.name, "is back online");
  }
  if (typeof d.lux === "number") updateDark(s, d.lux);
  if (typeof d.motion === "number") {
    if (d.motion === 1) {
      let minRssi = opt(s.cfg, "MIN_RSSI", null);
      if (minRssi !== null && rssi < minRssi) {
        dbg(s.name + " motion ignored, RSSI " + rssi + " < " + minRssi);
      } else {
        onMotion(s);
      }
    } else {
      onNoMotion(s);     // "no motion" is always accepted so slots never get stuck on a weak packet
    }
  }
}

function onScan(ev, res) {
  if (ev !== BLE.Scanner.SCAN_RESULT) return;
  try {
    if (!res || !res.service_data) return;
    let sd = res.service_data["fcd2"];     // BTHome service UUID 0xFCD2
    if (!sd) return;
    let s = findSensor(res.addr);
    if (s === null) {
      dbg("unconfigured BTHome device " + res.addr);
      return;
    }
    let d = parseBthome(sd);
    if (d === null) return;
    handlePacket(s, d, res.rssi);
  } catch (e) {
    print("ERROR in scan handler:", e);
  }
}

// ---------- manual override ----------
function onStatus(status) {
  try {
    if (CONFIG.MANUAL_OVERRIDE_MIN <= 0) return;
    if (status.component.indexOf("switch:") !== 0) return;
    let id = status.delta.id;
    if (typeof id !== "number" || typeof status.delta.output !== "boolean") return;
    if (id < 0 || id > 3 || !slotUsed[id]) return;
    if (now() - lastSetTs[id] < 2000) return;       // change caused by our own command
    if (slotOn[id] === status.delta.output) return;
    slotOn[id] = status.delta.output;
    overrideUntil[id] = now() + CONFIG.MANUAL_OVERRIDE_MIN * 60000;
    print("Slot", id + 1, "switched manually, automation paused for", CONFIG.MANUAL_OVERRIDE_MIN, "min");
  } catch (e) {
    print("ERROR in status handler:", e);
  }
}

// ---------- housekeeping: override expiry and offline fail-safe ----------
function housekeeping() {
  try {
    let t = now();
    let resync = false;
    for (let id = 0; id < 4; id++) {
      if (overrideUntil[id] !== 0 && t >= overrideUntil[id]) {
        overrideUntil[id] = 0;
        resync = true;
        print("Slot", id + 1, "manual override ended");
      }
    }
    if (CONFIG.OFFLINE_AFTER_MIN > 0) {
      for (let i = 0; i < sensors.length; i++) {
        let s = sensors[i];
        if (s.active && !s.offline && t - s.lastSeen > CONFIG.OFFLINE_AFTER_MIN * 60000) {
          s.offline = true;
          print(s.name, "active but silent for", CONFIG.OFFLINE_AFTER_MIN, "min");
          if (CONFIG.OFFLINE_ACTION === "off") {
            clearOff(s);
            s.active = false;
            resync = true;
          }
        }
      }
    }
    if (resync) sync();
  } catch (e) {
    print("ERROR in housekeeping:", e);
  }
}

// ---------- start ----------
function readSlotState(id) {
  Shelly.call("Switch.GetStatus", { id: id }, function (res, err, msg, ud) {
    if (err !== 0 || !res) {
      print("ERROR: Switch.GetStatus slot", ud + 1, "failed:", err, msg);
      return;
    }
    slotOn[ud] = res.output;
    if (CONFIG.OFF_AT_START && res.output) setSwitch(ud, false);
  }, id);
}

function startScanner() {
  if (typeof BLE.Scanner.Subscribe === "function") BLE.Scanner.Subscribe(onScan);
  else BLE.Scanner.subscribe(onScan);

  let running = (typeof BLE.Scanner.isRunning === "function") && BLE.Scanner.isRunning();
  if (running) {
    dbg("BLE scanner already running");
    return;
  }
  let opts = { duration_ms: BLE.Scanner.INFINITE_SCAN, active: CONFIG.ACTIVE_SCAN };
  let cb = function (res, err, msg) {
    if (err !== 0) print("ERROR: BLE scanner start failed:", err, msg);
  };
  if (typeof BLE.Scanner.Start === "function") BLE.Scanner.Start(opts, cb);
  else BLE.Scanner.start(opts, cb);
}

function start() {
  let ble = Shelly.getComponentConfig("ble");
  if (ble && ble.enable === false) {
    print("ERROR: Bluetooth is disabled on this device, enable it in the web UI (Settings > Bluetooth). Script not started.");
    return;
  }
  for (let id = 0; id < 4; id++) {
    if (slotUsed[id]) readSlotState(id);
  }
  Shelly.addStatusHandler(onStatus);
  startScanner();
  Timer.set(10000, true, housekeeping);
  print("blu-motion-trigger started:", sensors.length, "sensor(s)");
}

if (validConfig()) {
  initSensors();
  Timer.set(CONFIG.STARTUP_DELAY_S * 1000, false, start);
} else {
  print("ERROR: invalid CONFIG. Script not started.");
}
