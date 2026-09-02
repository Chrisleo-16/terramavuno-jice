# NOTICE

**Contains code derived from God's Eye View (MIT), https://github.com/bilawalsidhu/gods-eye-view**

The `apps/globe` workspace is a fork of the God's Eye View CesiumJS shell
(Cesium bootstrap, map stack controller, world-overlay label system, style
shaders, panel framework, camera verbs, scenes/annotations engines, and the
glass visual identity in `style.css`), adapted for TerraMavuno's
"Kilimo, Nitapata?" Kenya fertilizer-subsidy navigator.

## Third-party datasets

All third-party datasets bundled with God's Eye View were **removed** from
this fork, with one exception:

- **Kept:** `src/data/local_data/natural_earth/` — Natural Earth
  (https://www.naturalearthdata.com/), **public domain**.
- **Removed:** TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0 —
  non-commercial, must never ship), OpenStreetMap/Open Infrastructure Map
  datacenter and dam extracts (ODbL), SF neighborhood polygons, NASA FIRMS
  fixtures, and all aircraft/ship 3D models under `public/models/`.

All live GEV data feeds (OpenSky, AISStream, CelesTrak, TomTom, NASA FIRMS,
Radio Browser, CCTV, etc.) and their proxy middlewares were removed as well.

## Upstream license (verbatim)

```
MIT License

Copyright (c) 2026 Bilawal Sidhu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The original upstream `LICENSE` file is preserved alongside this notice.
