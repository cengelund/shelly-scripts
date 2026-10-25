# Shelly Scripts

A collection of [Shelly Script](https://shelly-api-docs.shelly.cloud/gen2/Scripts/ShellyScriptLanguageFeatures) (mJS) scripts for Gen2+ Shelly devices. Each script lives in its own folder under `scripts/` with its own README covering configuration and installation.

## Scripts

| Script | Device | Description |
|---|---|---|
| [power-follow](scripts/power-follow/) | Shelly Power Strip Gen4 | Slave slots follow the power draw of a master slot, with delays, minimum on-time, startup handling and periodic re-check |
| [blu-motion-trigger](scripts/blu-motion-trigger/) | Shelly Power Strip Gen4 (any Gen2+ with Bluetooth) | A Shelly BLU Motion sensor switches slots, fully local, with lux threshold, off-delay, multiple sensors, RSSI filter, manual override and fail-safe |

## Repository layout

```
.
├── LICENSE
├── README.md                 # this file, index of all scripts
├── ansible/                  # enrolling devices and deploying scripts, see ansible/README.md
└── scripts/
    └── <script-name>/
        ├── README.md         # purpose, config, installation
        └── <script-name>.js
```

## Adding a script

1. Create `scripts/<script-name>/` with the script file and a `README.md` (what it does, target devices, configuration table, installation steps).
2. Add a row to the table above, linking to the folder.

## Installing a script on a Shelly

**Manually:** in the device's web UI (`http://<device-ip>`): **Scripts** → **Create script** → paste the code → **Save** → **Start**, and enable **Run on startup**. See each script's README for details.

**Automated:** the [Ansible playbooks](ansible/) enroll devices and deploy any script in this repo to one or more devices over the RPC API. They also verify that the script is running and set to start on boot, with an optional reboot test.

## Disclaimer

Scripts are provided as is. Check the load ratings of your device and connected equipment, and test with low-risk loads first.

## License

[MIT](LICENSE) © Claus Engelund Thomsen

Free to use, modify and distribute, including commercially. The only condition is that the copyright and license notice is kept in copies and substantial portions of the software.
