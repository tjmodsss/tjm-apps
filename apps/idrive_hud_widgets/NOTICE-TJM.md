# TJM HUD Widgets

Imported into the TJM apps from https://github.com/bimmer-lab/apps.git (commit ab81cee4d778), app `idrive_hud_widgets`,
"HUD Widgets" by its author (MIT, see LICENSE). TJM changes (2026-11-10): the name
"TJM HUD Widgets", the TJM icon, vendor and logging id.

Needs on the head unit: cluster-render.
Updated to the source's commit ab81cee4d778 on 2026-11-16 (was 085a4e5a766a); the TJM changes kept.

TJM change (2026-11-21): `kit/` holds the source's own kit modules (from its `kit/runtime` at the same commit, the
ones that differ from the TJM kit), laid over the TJM kit by build.py, so its pixel images (record.setImage) reach
the Store's renderer (mgu-render/1) as they do in the source.
Refresh it after each update: `python auto-update\kit_overlay_ct.py "<TJM Apps>"` (master copy).
