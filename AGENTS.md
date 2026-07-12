# Young Family Chore App — Codex Context

## How Handoffs Work
- **Cowork → Codex**: Check `TASK.md` for the current task. Do it, write results/status to `RESULT.md`, delete `TASK.md` when done.
- **Codex → Cowork**: Write output to `RESULT.md`. Cowork (Bradford's AI assistant) will read it on the next turn.

---

## Project Overview
Young family dashboard PWA + Home Assistant integration. 

- **Live app**: https://acmdad17.github.io/youngfamilychoreapp/
- **TV dashboard**: https://acmdad17.github.io/youngfamilychoreapp/tv.html
- **GitHub repo**: https://github.com/acmdad17/youngfamilychoreapp (branch: main)
- **Firebase project**: young-family-770d5
- **Firebase RTDB**: young-family-770d5-default-rtdb.firebaseio.com

**Deploy rule**: Bradford pushes manually — never `git push` via Codex without being asked. Run `git add -A && git commit -m "message" && git push` from this folder.

---

## Home Assistant

- **Local URL**: http://homeassistant.local:8123
- **Nabu Casa**: https://isf2pjcd455ui5hvom8ua4pngmmch8gq.ui.nabu.casa
- **HA config files**: `Z:\` (mapped Samba share → `\\homeassistant.local\config`)
  - Main config: `Z:\configuration.yaml`
  - After editing config files: HA needs a **full restart** for go2rtc changes; `homeassistant.check_config` for validation
- **HA token**: Long-lived tokens expire — fetch fresh from HA browser tab: `JSON.parse(localStorage.getItem('hassTokens')).access_token`

### Key Entity IDs
| Entity | Description |
|--------|-------------|
| `person.admin42` | Bradford (NOT person.bradford) |
| `person.brooke` | Brooke |
| `person.audrey` | Audrey |
| `person.christian` | Christian |
| `sensor.sonoff_1001490be9_power` | Dishwasher watts |
| `sensor.sonoff_1001490d00_power` | Washing machine watts |
| `counter.dishwasher_pods` | Dishwasher pod count |
| `counter.washing_machine_pods` | Laundry pod count |
| `switch.den_light_switch_1` | Den light |
| `switch.hallway_switch_1` | Hallway light |
| `switch.kitchen_switch_1` | Kitchen light |
| `media_player.everywhere` | All Alexa speakers |
| `weather.forecast_home` | Outside temp |
| `camera.homeassistant_local` | Front Porch (wyze-bridge, currently unavailable) |
| `camera.homeassistant_local_2` | Back Yard / Pet Cam (wyze-bridge, streaming ✓) |
| `camera.garage` | Garage (RTSP direct — in progress) |

### Automations
| ID | Alias | Notes |
|----|-------|-------|
| `1717097065977` | Dishwasher Ends | TTS + push + firebase trigger |
| `1717097603235` | Washing Machine Finished | TTS + push + firebase trigger |
| `young_family_alert_1783371173935` | Young Family Alert | Webhook → TTS + push |
| `automation.track_family_presence_in_firebase` | Track Family Presence | ENABLED — syncs home/away to Firebase |

### rest_command (configuration.yaml)
```yaml
rest_command:
  firebase_ha_trigger:
    url: "https://young-family-770d5-default-rtdb.firebaseio.com/ha_triggers.json"
    method: POST
    content_type: "application/json"
    payload: >-
      {"type":"{{ type }}","label":"{{ label }}","emoji":"{{ emoji }}",
      "triggeredBy":"Home Assistant","triggeredAt":{{ (now().timestamp()*1000)|int }},
      "claimedBy":null,"active":true}
```

---

## Cameras

### wyze-bridge Add-on
- **Slug**: `7094bb28_docker_wyze_bridge`
- **Web UI**: http://homeassistant.local:8123/7094bb28_docker_wyze_bridge (use phone — hangs Chrome desktop)
- **Status**: Running. Only pet cam (camera.homeassistant_local_2) streams reliably. Other cameras on the shared Wyze account (11 total, including J.R. Bergenstock's and school cameras) timeout or show offline. Root cause: too many simultaneous TUTK connections competing for slots.
- **Current options**: ENABLE_AUDIO=false, ON_DEMAND=true, WB_AUTH=false, MOTION_API=false, MQTT=false, NET_MODE=P2P

### Garage Camera (RTSP direct)
- **IP**: 192.168.0.36
- **RTSP URL**: `rtsp://Acmdad:P%40ssword42@192.168.0.36:322/stream0`
- **Status**: In progress — adding as Generic Camera integration in HA

### Cameras Dashboard
- **URL**: http://homeassistant.local:8123/cam-view
- **Cards**: Front Porch (camera.homeassistant_local), Back Yard (camera.homeassistant_local_2), Garage (camera.garage)

### motionEye
- Add-on `a0d7b954_motioneye` is installed — could be used for motion recording

---

## Firebase Database Paths
| Path | Access | Purpose |
|------|--------|---------|
| `ha_triggers/` | unauthenticated write | HA posts events here |
| `familyAlerts/` | auth required | Alert overlays in app |
| `presence/` | auth required | Family home/away state |

### ha_triggers Flow
1. HA POSTs to `ha_triggers/` 
2. App listener fires, routes by type
3. `type=presence` → writes to `presence/<label>`
4. Others → mirrors to `familyAlerts/ha_<id>`
5. Marks `_processed: true`, auto-deletes entries >1hr

---

## Stack
- **App**: Single-file PWA (`index.html` + `sw.js` + `manifest.json`)
- **Auth**: Firebase anonymous auth
- **Sync**: Firebase Realtime Database
- **HA integration**: REST commands + webhooks + presence automation

## Notes
- `index.html` is large (100KB+) — never push via GitHub MCP, always let Bradford push manually
- `rest_command` changes require full HA restart (not just reload)
- All TTS automations presence-gate via iCloud device trackers

## Imported Claude Cowork project instructions
