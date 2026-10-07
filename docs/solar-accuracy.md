# Solar calculation accuracy

The viewer's solar engine uses the NOAA fractional-year approximation for the
equation of time and solar declination. It calculates geometric solar altitude
and true-north azimuth from a local calendar date, local clock time, latitude,
longitude, and an IANA time zone.

IANA time-zone data is read through the browser or Node `Intl` implementation,
so daylight-saving changes and fractional offsets are applied for the selected
date. Sunrise and sunset use a 90.833-degree zenith, which accounts for standard
atmospheric refraction and the apparent radius of the Sun.

This is appropriate for visualization, garden planning, and approximate direct
sun studies. It is not a survey or a photovoltaic production guarantee. Local
horizon obstructions, terrain beyond the model, unusual atmospheric conditions,
and the model's north alignment can have a larger effect than the astronomical
approximation. Near polar sunrise/sunset transitions, the module reports polar
day or polar night rather than inventing clock times.
