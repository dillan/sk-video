# Demo camera stills

The screenshot harness can stream a **still image** per camera view instead of the ffmpeg test pattern, so the docs show a representative "normal happy-path" picture — a real marine scene — that comes out identical every run. A single looping still is the most stable possible "video": no motion, constant frame, no decode surprises.

## How it's wired

`../mediamtx.yml` defines one RTSP path per view; each runs [`../stream-still.sh`](../stream-still.sh), which **loops the matching image if present, else falls back to a labelled test card** — so the harness works with or without these files. The screenshot spec seeds one demo camera per view, pointed at its path, with the matching mount/role/bearing so the Live Wall tells a coherent story.

Drop your generated images here as **JPG**, 16:9, 1080p or 4K, with these exact names:

| File              | Camera      | Mount · aim                                        |
| ----------------- | ----------- | -------------------------------------------------- |
| `foredeck.jpg`    | Foredeck    | mast, looking **forward & down** over the foredeck |
| `stern.jpg`       | Stern       | mast, looking **aft & down** over the cockpit      |
| `bow.jpg`         | Bow         | bow pulpit, looking **forward** over the water     |
| `port.jpg`        | Port        | port rail, looking **abeam to port**               |
| `starboard.jpg`   | Starboard   | starboard rail, looking **abeam to starboard**     |
| `engine-room.jpg` | Engine Room | engine bay (interior)                              |

Then regenerate: `cd ../screenshots && ./capture-all.sh --admin --copy`.

These are **fixtures, not code** — keep them small (a 1080p JPG at ~85% quality is plenty for docs).

---

## Generating the images (Midjourney / DALL·E)

The goal: six photorealistic frames that look like **raw output from a fixed wide-angle marine deck camera** — same vessel, same trim, same day — with **no** text, timestamp, watermark, logo, or UI overlay of any kind.

### Automated (OpenAI API)

If you have an OpenAI key, [`generate.sh`](generate.sh) produces all six directly from the prompts below:

```sh
cp .env.example .env      # then paste your key into .env (gitignored, never committed)
./generate.sh             # writes foredeck.jpg first, then the other five from it as a reference
```

It generates `foredeck` first and passes it as a **reference image** to the other five (OpenAI's image-edits endpoint) so the set stays one vessel on one afternoon — the same consistency trick as Midjourney's `--cref`, done automatically. Uses `gpt-image-1` at `1536x1024` (a few cents per run; override via `.env`). The manual Midjourney/DALL·E route below is equivalent if you prefer a different generator.

### Consistency first (read this before generating)

The six frames must read as **one boat on one afternoon**. Two ways to hold that:

- **Midjourney:** generate `foredeck` first, pick the best frame, then pass it as a **style + subject reference** on every other prompt: append `--sref <url-of-foredeck> --cref <url-of-foredeck> --cw 40` (low `--cw` keeps the _boat's_ look while letting the framing change). Keep `--ar 16:9 --style raw --v 6` on all six.
- **DALL·E 3:** it doesn't take image refs, so **paste the "Vessel & scene bible" verbatim** at the top of every prompt and change only the "This shot:" paragraph. Ask for "16:9, photorealistic, raw camera frame."

Whichever you use, request **no people** (or one crew member only where noted), and explicitly exclude overlays (the bible does this).

### Vessel & scene bible (prepend to every prompt)

> A 46-foot modern cruising **sloop** (sailing yacht) under way in open water. Glossy **white** fiberglass topsides with a single **navy-blue cove stripe** just below the rail; **pale silver-grey non-skid** decks; **varnished teak** toe rail, handrails and cockpit coamings; **navy-blue canvas** dodger, bimini and sail cover with brushed **stainless-steel** frames; **silver anodized aluminum** mast and boom; brushed stainless stanchions with double lifelines. Late-morning sun, clear sky with a few soft cumulus, ~12-knot breeze, deep **cobalt-blue** offshore water with light whitecaps, a faint low **headland on the horizon**, gentle heel to **starboard**. Shot on a **fixed wide-angle marine deck camera**: ~120° field of view with slight barrel distortion, deep depth of field, bright daylight white balance, natural contrast, faint sensor noise. **Photorealistic, raw uncorrected camera frame. Absolutely no text, no timestamp, no watermark, no logo, no on-screen graphics or UI overlays. No readable lettering on the boat. 16:9.**

### The six shots

**1 — `foredeck.jpg` (mast → forward & down over the foredeck)**

> This shot: mounted high on the mast looking forward and slightly down along the centreline. In frame: the coachroof and a flush forward hatch, side decks with the teak toe rail running to a **stainless bow pulpit** and anchor roller at the far end, a **furled headsail** on the forestay, deck cleats and a low winch; open cobalt water and the high horizon beyond the bow. No people. `--ar 16:9 --style raw --v 6`

**2 — `stern.jpg` (mast → aft & down over the cockpit)**

> This shot: mounted high on the mast looking aft and down. In frame: the coachroof, the **navy dodger and bimini**, the cockpit with a **stainless wheel and binnacle**, cockpit coamings and winches, the boom edge across the top of frame, the backstay, and the **wake trailing astern** to the horizon. Optionally one crew member at the helm, seen from above, no readable clothing logos. `--ar 16:9 --style raw --v 6`

**3 — `bow.jpg` (bow pulpit → forward over the water)**

> This shot: mounted on the bow pulpit looking dead ahead. Lower foreground filled by the **stainless pulpit rails and anchor roller** and the tip of the furled headsail; the rest is open cobalt water, the **bow wave and light spray** at the waterline, whitecaps, and a big sky with soft cumulus. No people. `--ar 16:9 --style raw --v 6`

**4 — `port.jpg` (port rail → abeam to port)**

> This shot: mounted on the **port** side rail looking outboard. Near foreground: the side deck, teak toe rail and **stanchions with double lifelines** crossing the frame, a sliver of white topside below. Beyond: cobalt water sliding past, light whitecaps, the low headland on the mid-frame horizon. Because the boat heels to starboard, the port rail sits a little **higher** above the water. `--ar 16:9 --style raw --v 6`

**5 — `starboard.jpg` (starboard rail → abeam to starboard)**

> This shot: the mirror of the port view — mounted on the **starboard** side rail looking outboard. Same side-deck, teak toe rail, stanchions and lifelines in the near foreground; the **same low headland** on the horizon, seen from the opposite side. Because the boat heels to starboard, the starboard rail sits **lower**, closer to the passing water and a little spray. `--ar 16:9 --style raw --v 6`

**6 — `engine-room.jpg` (engine bay, interior)**

> Ignore the outdoor scene for this one, but keep the same boat quality. This shot: a tidy sailboat **engine compartment** lit by a cool LED work light — a compact **marine diesel** (beige/cream block) with belts and a black alternator, coolant header tank, twin fuel filters, a stainless exhaust elbow, neatly loomed wiring, cream **sound-insulation foam** on the hatch walls, a clean bilge below. Photorealistic, raw camera frame, no text/labels/overlays. 16:9. `--ar 16:9 --style raw --v 6`

### Tips

- If a frame comes out with invented text/logos on the sails or transom, add `no text, no writing, blank sails` (MJ) or restate "no readable lettering anywhere" (DALL·E) and re-roll.
- Keep the sun direction and cloud style consistent — mention "sun high and slightly aft" on each if a model drifts.
- Downscale/compress to ~1080p JPG before saving here; the harness re-encodes to H.264 anyway.
