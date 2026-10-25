# power-follow

A Shelly script for the **Shelly Power Strip Gen4** that makes slave slots follow the power draw of a master slot.

- Master slot draws **more than** the threshold → slave slots switch **on**.
- Master slot draws **at or below** the threshold → slave slots switch **off**.

Typical use: switch on peripherals (monitor, speakers, printer) only while the main device is actually running.

## Features

- Configurable master slot, slave slots and power threshold
- On-delay and off-delay to ignore short spikes and dips
- Minimum on-time once the slaves have switched on
- Startup delay
- Periodic re-check that recovers from missed events and failed switch commands
- Optional enforcement of the desired state (corrects manual toggles of slave slots)
- Error handling on every call, debug logging (off by default)

## Configuration

Edit the `CONFIG` block at the top of `power_follow.js`. Slots are numbered 1-4 as printed on the strip.

| Setting | Default | Description |
|---|---|---|
| `MASTER_SLOT` | `1` | Slot whose power is monitored |
| `SLAVE_SLOTS` | `[2, 3]` | Slots that are switched |
| `THRESHOLD_W` | `10` | On when power > value, off when power <= value |
| `ON_DELAY_S` | `3` | Power must stay above the threshold this long before switching on |
| `OFF_DELAY_S` | `30` | Power must stay at or below the threshold this long before switching off |
| `MIN_ON_TIME_S` | `60` | Minimum time slaves stay on once switched on |
| `STARTUP_DELAY_S` | `2` | Wait after script start |
| `RECHECK_S` | `60` | Re-check interval, `0` disables |
| `ENFORCE_STATE` | `true` | Re-check also corrects slaves that don't match the desired state |
| `DEBUG` | `false` | Verbose logging |

## How it behaves

- **Switching on:** power must stay above `THRESHOLD_W` for `ON_DELAY_S` seconds. A dip during that time cancels the countdown.
- **Switching off:** power must stay at or below `THRESHOLD_W` for `OFF_DELAY_S` seconds, and the slaves must have been on for at least `MIN_ON_TIME_S`. Whichever takes longer applies. Power rising again cancels the countdown.
- **After power-up or reboot:** with "Run on startup" enabled, the script starts by itself, waits `STARTUP_DELAY_S`, reads the master slot's current power and puts the slave slots in the matching state. It does not matter whether the slave slots restore as on or off after power loss, the script corrects them within seconds.
- **Re-check:** every `RECHECK_S` seconds the script re-reads the master power and (with `ENFORCE_STATE`) the slave states, which recovers from missed events and failed switch commands.

## Installation

### Automated (recommended)

Use the Ansible playbooks in [`ansible/`](../../ansible/). They create the script, upload the code, enable "Run on startup", start it and verify that it is running:

```sh
cd ansible
ansible-playbook -i inventory.yml deploy-script.yml --limit <strip>
ansible-playbook -i inventory.yml deploy-script.yml --limit <strip> -e verify_reboot=true   # also tests start after reboot
```

### Manual

1. Open the strip's web UI (`http://<strip-ip>`).
2. Go to **Scripts** → **Create script** and name it, e.g. `power_follow`.
3. Paste the contents of `power_follow.js` and click **Save**.
4. Click **Start**. The console should print `power-follow started: ...`.
5. Enable **Run on startup**.

### Check that it runs

```sh
curl http://<strip-ip>/rpc/Script.List
```

The entry for `power_follow` should show `"enable": true` (starts on boot) and `"running": true`. To test power-up behavior, unplug the strip, plug it back in and check again after about 30 seconds.

## Zigbee and Matter mode

The script runs on the strip and only uses local power readings and local switching, so it does not depend on Wi-Fi, Matter or Zigbee. Shelly does not document whether scripting is available in the Zigbee firmware mode, so after switching modes check `Script.List` as above and run a load test. Remote deployment with Ansible needs the strip to stay reachable over Wi-Fi.

## Notes

- If the master slot is switched off, its power reads 0 W, so the slaves switch off after the off-delay.
- With `ENFORCE_STATE` on, manual changes to slave slots are reverted at the next re-check. Set it to `false` if you want to switch the slaves by hand.
- A Shelly can run only a limited number of scripts at once (3 per the Shelly docs).
- Use at your own risk, and check the load ratings of your strip and connected devices.

## License

[MIT](../../LICENSE)
