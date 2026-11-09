# Car Lyrics

Synced lyrics for whatever the car is playing: Apple Music over CarPlay, Bluetooth or USB. No Spotify
account and no app on the phone.

Version 0.3.1 · iDrive 7 · package `aref_carlyrics` · [all apps and how to install](../../README.md)

## Who it's for

Apple Music listeners. G's Music shows synced lyrics, but it plays through Spotify's Web API and needs
Spotify Premium. Apple offers no API for another device to read or control what an iPhone is playing.
Car Lyrics takes the track from the head unit instead: the car already receives the title, artist and
time in the song from CarPlay to show them in its own media screens.

## What it does

- **Full screen, drawn like Apple Music on a Mac:** two blurred layers of the album art flowing behind
  the page, the cover with the title, artist and a progress line centred on the left, and the lyrics on
  the right in big bold type (Inter Display, the open look-alike of Apple's SF Pro). The line being sung
  is full white; the lines to come show at 40 % and the ones sung at 25 %, softly blurred, more the
  further they are. The lyrics glide up line by line, and instrumental breaks show three dots that fill
  up until the next line.
- **Timing from the car:** CarPlay sends the time in the song about once a second. The app runs its own
  clock between those updates, so the lyrics move smoothly, and it stops when you pause. Skips, seeks
  and new songs are picked up on their own.
- **Album art:** from Apple's iTunes Search API, the same artwork Apple Music shows (the car doesn't pass
  CarPlay's artwork on to apps).
- **Lyrics:** from [LRCLIB](https://lrclib.net), a free, open database of synced lyrics.
- **Lyrics timing** (Settings): moves the lyrics up to 3 s earlier or later.
- **Song just started:** only for a source that sends no time (some Bluetooth players). Tap it when the
  song starts to sync the lyrics.

Needs internet through the Store's uplink (Wi-Fi or a phone hotspot), for the lyrics and the artwork.
Full screen needs the GPU renderer that G's Dash and G's Music use. Without it, the page shows in the
standard frame with the HMI's buttons.

## Screens

Screens rendered on a PC from the app's own drawing code with made-up data (`tools/screens.js`), not photos of a car.

### Lyrics

![Lyrics](../../docs/screenshots/aref_carlyrics/lyrics.png)

The song, its cover and its lyrics here are made up.

### Probe

![Probe](../../docs/screenshots/aref_carlyrics/probe.png)

The **Probe** tab: every value the car sends from the CarPlay and media interfaces.

### Home-screen widget

![Home-screen widget](../../docs/screenshots/aref_carlyrics/widget.png)

Add it to the iDrive home screen like BMW's own widgets: the song and the lyric line playing, with a progress bar. The small size shows the same as two lines of text.

## The probe

The track comes from BMW's `MediaPlayer` interface (CarPlay is its instance `CarPlayMedia`):
`currentItemMetadata` for the title, artist and album, `currentItemTime` for the time in the song, and
`playerState` for play and pause. The app also subscribes to every field of `CarPlayManager`,
`HmiMediaState` and `DynamicMediaPlayer`, for other sources. The **Probe** screen has three pages:

- **Values the car sends:** every field and its latest value.
- **Media interfaces in the catalog:** interfaces in the unit's SOME/IP catalog whose definitions name a
  title, an artist or now-playing data.
- **Subscriptions:** which interfaces answered.

**Save report** writes all of it to `carlyrics-probe.txt` in the app's data folder; it is also written
every minute. A report from a car playing Apple Music tells the next version exactly which field to use.

## Safety

Read-only toward the car: it subscribes to and reads fields, and never calls a method or writes a value. It
draws only on the centre screen.

## Credits

The lyrics client (`stage/lyrics.js`) and the artwork resampling are from nickgcode's G's Music (MIT).
The JPEG decoder (`vendor/jpeg_decoder.js`) is jpeg-js (BSD-3-Clause) with pdf.js's decoder core
(Apache 2.0), as vendored in G's Music. The fonts in `data/fonts/` are baked from
[Inter](https://github.com/rsms/inter) (SIL Open Font License 1.1, `data/fonts/LICENSE-Inter.txt`) by
`tools/bake_fonts.py`. See `LICENSE`.
