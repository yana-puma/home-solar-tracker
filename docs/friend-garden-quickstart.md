# Use Home Solar Tracker for your garden

The software can live on public GitHub. Keep your house ZIP on your own computer. It contains the model and coordinates; it does not belong in the public repository.

## First time

1. Clone `https://github.com/yana-puma/home-solar-tracker.git`, or download its source ZIP and extract it (after the reviewed source has been published).
2. Install Python 3 if it is not already available. You do not need the modeling libraries, Node, an account, or an application build to use the viewer.
3. Open a terminal in the extracted repository folder. On Windows, run `py -3 scripts/serve.py`. On macOS or Linux, run `python3 scripts/serve.py`.
4. Open the printed `http://127.0.0.1:8080/?local=1` link in Chrome, Edge, or Safari.
5. Choose your complete house ZIP. The viewer checks its files and hashes, then opens the model locally. Internet access is needed to load the pinned Three.js library on first use. Your chosen house files are not uploaded.

Keep the terminal running while you use the viewer. Stop it with Ctrl+C when finished. If the port is already busy, append `--port 8081` and use the new printed link.

## A useful first garden study

1. Check that the expected region, revision, house shape, and garden zones appear. If the viewer warns that it is showing a different house, stop interpreting the results and open the correct ZIP.
2. Open **Controls → Sun & Shade**. Set the date you care about. For Strasburg, Virginia, the package timezone should be `America/New_York`.
3. Choose a garden zone and **Quick** exposure quality. Before a calculation, the zone has no sunlight hours assigned.
4. Choose **Run Model Exposure**. Read the modeled daily ground sunlight and whether it meets the zone's minimum-hour target.
5. Repeat for a spring date, a summer date, and a late-season date relevant to what you grow. **Show second solar path** compares astronomical paths; run exposure separately on each primary date to compare shade.
6. Use **Standard**, or **High** for a small bed, when you want a finer grid. An area smaller than a grid cell may use a clearly labeled nearest-point fallback.
7. Use **Export JSON** or **Export CSV** to keep the study summary. These are result files, not a replacement for your house ZIP.

The hours describe modeled direct sun at ground level. They do not assess a raised bed, roof, or window surface; those zones show no ground result. A preferred time window is recorded but not assessed by the daily summary. No crop choice, weather, plant health, leaf season, or unmodeled tree can be inferred from the colors alone. Compare the simulation with observations in your garden before making planting decisions.

## Reopen and compare notes

After reloading or restarting, choose the same ZIP again. **Copy study settings link** preserves the date, camera, zone, comparison, and exposure quality. A local settings link does not send the house model: the other person needs the same ZIP and their own local server. If their server uses another port, replace the beginning of the link with their printed localhost address and keep everything after `?`.

## Prepare your house package

A maintainer can help with this once. Home Solar Tracker does not turn an address into a complete house model.

- Start with a self-contained GLB containing the house and relevant trees, fences, neighbors, and terrain. A measured footprint plus verified heights can make a simplified model; survey or aerial data needs preprocessing and review.
- Open **Build a package**. Choose the GLB and enter the house's coordinates locally. Example coordinates must be replaced.
- Use a measured dimension to set scale. Units describe the source; scale converts decoded coordinates into meters. Set true north from a known bearing, position the model on the ground, and set ground bounds large enough to include the garden.
- Add two or three **ground** garden zones, preferably rectangles. The blue outlines preview zone placement in viewer meters. Set a minimum sunlight target if useful.
- Review calibration QA and check the location, scale, north, ground bounds, and zone placement against the house. Complete ZIP export waits for a successful preview, no QA errors, your review checkbox, and privacy preflight.
- Choose **Local only** and export the complete ZIP. Save it somewhere private outside the repository. **Save draft ZIP** and **Reopen ZIP** preserve a schema-valid model, calibration, and zones while you work; drafts have not passed complete-study readiness.

Keep the original model and source measurements privately, too. If you edit the model or calibration, give the new package a new revision so saved studies can identify it.
