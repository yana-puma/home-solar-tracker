# Example property

This directory demonstrates the version 1 property configuration format without publishing a real street address or exact household location.

The model path in `property.json` points to the repository's generic `output/property_model.glb` fixture. Replace it with `./model.glb` when packaging a self-contained property:

```text
properties/
  my-property/
    property.json
    model.glb
```

Then open the viewer using `?property=my-property`. A direct configuration path can also be selected with `?config=properties/my-property/property.json`.

Use `configure/index.html` through a local static web server to import, validate, preview, and export configuration files. Local GLB previews use an in-memory browser URL and are never uploaded by the configurator.

Before publishing, check both privacy flags and remember that coordinates remain present in the JSON because the solar calculation needs them. Use a broad `displayLabel` unless the owner has explicitly chosen to publish an address.
