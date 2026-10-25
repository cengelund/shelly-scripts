# blu-motion-trigger

A Shelly script for the **Shelly Power Strip Gen4** (and any other Gen2+ Shelly with Bluetooth) that lets a **Shelly BLU Motion** sensor switch one or more slots. Everything runs on the strip itself: no cloud, no gateway, no Home Assistant.

- Motion while it is **dark** → mapped slots switch **on**.
- No motion (plus an optional extra delay) → mapped slots switch **off**.

The strip listens passively for the sensor's Bluetooth advertisements (BTHome format) and decodes motion, illuminance and the packet counter.

## Features

- **Lux threshold with hysteresis:** only trigger when it is dark. Separate "dark below" and "bright above" levels avoid flapping around one value.
- **Extra off-delay:** keeps the slot on for a set time after "no motion", on top of the sensor's own blind time (30 to 600 s, set on the sensor).
- **Multiple sensors:** each sensor (by MAC address) maps to one or more slots. A slot stays on as long as any sensor mapped to it is active.
- **Sensor-offline fail-safe:** if an active sensor is silent for too long, its slots are switched off (or only logged).
- **RSSI filter:** ignore motion from sensors with a weak signal, useful to separate rooms. "No motion" packets are always accepted, so a slot can't get stuck on a weak packet.
- **Manual override:** if you toggle a controlled slot by hand (button, app or web UI), automation for that slot pauses for a configurable time.
- Duplicate advertisements are dropped using the packet ID. Encrypted sensors are ignored.
- Switch-off of controlled slots at start (after a power cut), startup delay, error handling, debug logging (off by default).

## Configuration

Edit the `CONFIG` block at the top of `blu_motion_trigger.js`. Slots are numbered 1-4 as printed on the strip.

Per sensor (`CONFIG.SENSORS`):

| Setting | Example | Description |
|---|---|---|
| `MAC` | `"aa:bb:cc:dd:ee:ff"` | Sensor MAC address, **lowercase**. The script refuses to start with the placeholder |
| `NAME` | `"hallway"` | Name used in log messages |
| `SLOTS` | `[4]` | Slots switched by this sensor |
| `LUX_DARK_BELOW` | `50` | Dark when lux is below this. `null` ignores the light level |
| `LUX_LIGHT_ABOVE` | `60` | Bright when lux is above this. Between the two values the previous state is kept |
| `OFF_DELAY_S` | `60` | Extra seconds to keep slots on after "no motion" (`0` = none) |
| `MIN_RSSI` | `-85` | Ignore motion packets weaker than this (`null` = accept all) |

Global:

| Setting | Default | Description |
|---|---|---|
| `MANUAL_OVERRIDE_MIN` | `10` | Pause automation for a slot this many minutes after a manual toggle (`0` = disabled) |
| `OFFLINE_AFTER_MIN` | `120` | Minutes of silence from an **active** sensor before the fail-safe applies (`0` = disabled) |
| `OFFLINE_ACTION` | `"off"` | `"off"` switches its slots off, `"keep"` only logs it |
| `OFF_AT_START` | `true` | Switch controlled slots off when the script starts |
| `STARTUP_DELAY_S` | `2` | Wait after script start |
| `ACTIVE_SCAN` | `false` | Passive scanning saves sensor battery |
| `DEBUG` | `false` | Verbose logging, also prints MACs of unconfigured BTHome devices |

### Finding the sensor's MAC address

1. Set `DEBUG: true` and put any valid-looking MAC (not all zeros) in `MAC`.
2. Start the script and wave your hand in front of the sensor.
3. Read the script console: lines like `unconfigured BTHome device aa:bb:cc:dd:ee:ff` show nearby BTHome sensors. Copy yours into `MAC`, in lowercase.

## Requirements

- Bluetooth must be **enabled** on the strip. The Ansible provisioning playbook leaves it on by default (`shelly_disable_ble: false`).
- A BLU Motion sensor without encryption (the default).
- Keep the strip within Bluetooth range of the sensor. Metal strips and walls reduce range, check the RSSI in debug mode.

## Installation

Same as the other scripts: use the [Ansible playbook](../../ansible/) or paste the code in the strip's web UI under **Scripts**, save, start, and enable **Run on startup**.

```sh
cd ansible
ansible-playbook -i inventory.yml deploy-script.yml \
  -e script_dir=blu-motion-trigger -e script_file=blu_motion_trigger.js --limit <strip>
```

Edit the `CONFIG` block (at least the MAC address) before deploying. A Shelly can run only a limited number of scripts at once (3 per the Shelly docs), so this fits next to [power-follow](../power-follow/).

## How it behaves

- BLU Motion sends "motion" on the first movement and "no motion" when its blind time has passed without movement. With the default `OFF_DELAY_S` the slot stays on for that blind time plus the extra delay.
- Illuminance arrives together with motion packets. Until the first reading, the light level counts as dark.
- A slot already on stays on when it gets bright, until the sensor reports "no motion".
- During a manual override the script keeps tracking the sensors. When the override ends, the slot is set to what the sensors currently want.

## Notes and limitations

- BLU Motion transmits only on events unless beacon mode is enabled on the sensor, so silence while idle is normal. That is why the offline fail-safe only applies while a sensor is active. During long continuous movement the sensor may also stay silent, so don't set `OFFLINE_AFTER_MIN` too low. I couldn't confirm from Shelly's documentation whether the sensor re-sends motion packets during continuous movement.
- Only BLU Motion is supported. The decoder reads packet ID, battery, illuminance, motion and button objects, and stops at any unknown object.
- Bluetooth scanner method names differ between firmware versions (`Start`/`Subscribe` versus lowercase). The script tries both. Use a recent firmware.
- The logic is tested against a simulated device, not on real hardware. Test with a low-risk load first.
- Use at your own risk, and check the load ratings of your strip and connected devices.

## License

[MIT](../../LICENSE)
