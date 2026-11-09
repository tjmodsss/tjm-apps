# DDE 8.32 DPF DID research (unverified on vehicle)

Source: user-provided D83BX7C0.prg and d83bx7c0a(1).prg, 2026-11-09.
PRG strings are XOR 0xF7 encoded. These are metadata entries from the larger PRG; **not yet tested against the vehicle**.

| DID | PRG result | PRG German description | Raw type | PRG factor | Offset |
|---|---|---|---|---|---|
| 44BD | STAT_OELASCHENMASSE_WERT | Oelaschemasse | unsigned int (16-bit) | 0.01525902 | 0 |
| 44BE | STAT_RUSSMASSE_IM_PARTIKELFILTER_WERT | Russmasse | unsigned int (16-bit) | 0.01525902 | 0 |
| 44BF | STAT_STRECKE_SEIT_ERFOLGREICHER_REGENERATION_WERT | Seit der letzten erfolgreichen Regeneration gefahrene Strecke | unsigned long (32-bit) | 1 | 0 |
| 4B2E | STAT_PFLT_LTOTRECSTRT_WERT | Kilometerstand beim Start der DPF-Statistik | unsigned long (32-bit) | 1 | 0 |
| 4B2F | STAT_PFLT_LTOTAVGLDG_WERT | Durchschnittliche Strecke zwischen DPF-Regenerationen | unsigned long (32-bit) | 1 | 0 |
| 4B44 | STAT_PFLT_LAVGDSTRGN_WERT | Durchschnittliche Anzahl an Kilometer waehrend DPF-Regeneration | unsigned long (32-bit) | 1 | 0 |
| 4B54 | STAT_PFLT_CTTOTSUCRGN_WERT | Bitcodierte Information ueber die Anzahl der erfolgreichen Regenerationen | unsigned int (16-bit) | 1 | 0 |
| 4B52 | STAT_PFLT_MSOTRGNAVGSTART_WERT | Durchschnittliche Russmasse beim Start der Regeneration | unsigned int (16-bit) | 0.01 | -327.67 |
| 4B53 | STAT_PFLT_MSOTRGNAVGEND_WERT | Durchschnittliche Russmasse am Ende der Regeneration | unsigned int (16-bit) | 0.01 | -327.67 |

All these entries advertise service `22;2C` in PRG metadata. Read via physical UDS `22 <DID high> <DID low>` first, e.g. `22 44 BE`; a positive response begins `62 44 BE`. A negative response `7F 22 xx` means do not assume DID supported in current ECU/session.

`STATUS_REGENERATION_CSF` job has distinct results `STAT_REGENERATION_ANGEFORDERT_WERT` and `STAT_REGENERATION_LAEUFT_WERT` (0/1). Their direct read-only UDS DIDs are **not yet identified**; do not substitute inferred status.

Safety: never execute `ABGLEICH_CSF_PROG`, write/IO-control/routine or forced regeneration. Do not enable unrestricted `0x2C` in the MGU read-only transport.

Next: verify physical DDE address via ECU discovery, then request the four overview DIDs individually and capture raw UDS response, refusal or timeout; confirm units against diagnostic output before exposing numbers. The 4B54 count is bit-coded and cannot yet be treated as a plain integer. The PRG does not establish that a full historical list of regeneration events is available.
