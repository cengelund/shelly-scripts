# Ansible

Two playbooks:

- `provision-device.yml`: enroll a device (name, timezone, cloud/Bluetooth/AP settings, optional authentication)
- `deploy-script.yml`: deploy a script from `scripts/` to devices

## Requirements

- Ansible on a machine in the same network as the devices (only `ansible.builtin.uri` is used, no extra collections)
- Shelly Gen2+ devices reachable over HTTP, with authentication disabled (see the authentication caveat below)
- Devices should have a DHCP reservation and, ideally, a DNS name

## Enrolling a new device

1. Give the device a DHCP reservation and a DNS name.
2. Add it to the `shelly_strips` group in `inventory.yml` (`ansible_host: <dns name>`).
3. Check it answers: `curl http://<host>/rpc/Shelly.GetDeviceInfo`.
4. Provision it, then deploy scripts:

```sh
ansible-playbook -i inventory.yml provision-device.yml --limit strip-office
ansible-playbook -i inventory.yml deploy-script.yml --limit strip-office
```

### Provisioning variables

| Variable | Default | Description |
|---|---|---|
| `shelly_name` | inventory hostname | Device name (`Sys.SetConfig`) |
| `shelly_timezone` | `Europe/Copenhagen` | Timezone (`Sys.SetConfig`) |
| `shelly_disable_cloud` | `true` | Turn off the Shelly cloud connection |
| `shelly_disable_ble` | `true` | Turn off Bluetooth |
| `shelly_ap_enable` | not set | Set `false` to disable the Wi-Fi access point. Only do this once the device reliably joins your Wi-Fi, otherwise you can lock yourself out |
| `shelly_auth_password` | not set | If set, enables authentication (user `admin`) as the last step. Store it with Ansible Vault |

The playbook reboots the device only if a setting reports `restart_required`. Static IPs are intentionally not set by the playbook, use a DHCP reservation instead to avoid lock-outs.

### Authentication caveat

Shelly uses digest authentication, which `ansible.builtin.uri` does not support. After auth is enabled, neither playbook can configure the device any more (provisioning skips such devices). Leave `shelly_auth_password` unset on a trusted IoT VLAN, or adapt the tasks to use `curl --digest` before turning it on.

## Deploying scripts

Deploys any script from `scripts/` to Shelly Gen2+ devices using the device's HTTP RPC API (`Script.List`, `Script.Create`, `Script.Stop`, `Script.PutCode`, `Script.SetConfig`, `Script.Start`). No Shelly-specific Ansible collection is needed, only `ansible.builtin.uri`.

### Usage

```sh
cd ansible
cp inventory.example.yml inventory.yml     # edit IP addresses
ansible-playbook -i inventory.yml deploy-script.yml
```

Deploy a different script or a single device:

```sh
ansible-playbook -i inventory.yml deploy-script.yml \
  -e script_dir=<folder under scripts/> -e script_file=<file>.js
ansible-playbook -i inventory.yml deploy-script.yml --limit strip-office
```

### Variables

| Variable | Default | Description |
|---|---|---|
| `script_dir` | `power-follow` | Folder under `scripts/` |
| `script_file` | `power_follow.js` | Script file; the name on the device is the file name without `.js` |
| `chunk_size` | `1024` | Upload chunk size in bytes |
| `run_on_startup` | `true` | Enable "Run on startup" |
| `start_script` | `true` | Start the script after upload |
| `verify_reboot` | `false` | After deploying, reboot the device and check the script starts by itself |

### How it works

1. Lists the scripts on the device and looks for one with the same name.
2. Creates it if it doesn't exist.
3. Stops it (code can only be replaced while the script is stopped).
4. Uploads the code in chunks (first chunk overwrites, the rest are appended).
5. Sets run on startup and starts the script.
6. Verifies the script is running and enabled for startup (`Script.List`). With `verify_reboot=true` it also reboots the device and checks the script comes back on its own.

Re-running the playbook replaces the code with the current version from the repo.

### Notes

- Hosts are reached over plain HTTP from the machine running Ansible, so it must be on the same network as the devices.
- Devices with authentication enabled need digest auth, which `ansible.builtin.uri` does not support out of the box. Either disable auth on the local network or adapt the tasks.
- The script's `CONFIG` block is deployed as in the repo. For per-device settings, edit the script before deploying or template it with `lookup('template', ...)`.
- A Shelly can run only a limited number of scripts at once (3 per the Shelly docs).

### Zigbee and Matter mode

The Power Strip Gen4 runs either Matter (default) or Zigbee firmware. Shelly does not document whether Wi-Fi, RPC and scripting stay available in Zigbee mode, so verify it on a strip first: after switching modes, `curl http://<strip>/rpc/Script.List` must still answer. The playbooks only work while the strip is reachable over Wi-Fi. Avoid disabling the Wi-Fi access point (`shelly_ap_enable`) on strips used in Zigbee mode, it is your fallback if the strip loses its Wi-Fi connection.
