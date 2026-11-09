# Battery & Electrical

A 12 V battery monitor for the head unit, drawn in the house style. **Reading only — it
never writes to any control unit.** Useful on any car (unlike eDrive, which focuses on the
high-voltage battery of a hybrid or EV).

## What it shows

- **Voltage** (big) and the **state**: charging, at rest or discharging.
- **Current** from the intelligent battery sensor (IBS): charging or drawing, in amps.
- **Charge** (state of charge) and **State of health**, with bars; at rest, charge also
  falls back to an estimate from the resting voltage.
- **Temperature** of the battery.
- A **verdict** — good / aging / weak — and plain-language warnings (low resting voltage,
  low charge, low health, high charging voltage, high discharge).

## Where the data comes from

All values are read with UDS `0x22` (ReadDataByIdentifier) over the head unit's diagnostic
link, from the IBS via the engine unit — the same identifiers Live Data and eDrive use.
`v12` is **F442**, the standard OBD "control module voltage" (terminal 30 = the 12 V
battery); current, SOC, SOH and temperature are the IBS values. The DIDs and scalings are
in `app.json` under `config`; DIDs differ between models, so adjust there if a value shows
`--`. The IBS current is negative when discharging.

With no car present the app shows a synthetic battery cycling through charging, rest and a
load, so the screen is alive in the emulator.

## Build and test

```sh
python3 kit/tools/build.py dimon_battery        # offline preview without the SDK
node kit/tools/emu.js dimon_battery             # live emulator (needs the SDK)
node kit/tools/test_battery.js                  # the health logic
```
