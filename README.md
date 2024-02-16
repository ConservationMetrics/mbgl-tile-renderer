# mapgl-tile-renderer

[![Publish to DockerHub](https://github.com/ConservationMetrics/mapgl-tile-renderer/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/ConservationMetrics/mapgl-tile-renderer/actions/workflows/docker-publish.yml)

This headless Node.js MapGL renderer generates styled raster tiles in an MBTiles format. It can work with a self-provided stylesheet and tile sources, or an online source with an optional overlay. 

It uses [Maplibre-GL Native](https://www.npmjs.com/package/@maplibre/maplibre-gl-native) to render tiles, [Sharp](https://www.npmjs.com/package/sharp) to save them as an image, and Mapbox's [mbtiles Node package](https://www.npmjs.com/package/@mapbox/mbtiles) to compile them into an MBTiles database (which is a SQLite file).

The motivation to build this tool is to create offline background maps for use in mobile data collection applications, such as [Mapeo](https://mapeo.app/), [ODK Collect](https://getodk.org/), and [KoboToolbox Collect](https://www.kobotoolbox.org/). However, it can be used for many use cases where having self-hosted raster MBTiles is a requirement.

This tool started as an extension of [mbgl-renderer](https://github.com/consbio/mbgl-renderer), which was built to export single static map images. Our thanks go out to the contributors of that project.

## Requirements

Node version: 18.17.0 to 20.x.x. 

(Sharp requires 18.17.0 at minimum, and MapLibre Native is [currently only supported on stable releases of Node](https://github.com/maplibre/maplibre-native/issues/1058), 20 being the latest)

## Supported online sources

* Bing Imagery (Virtual Earth)
* ESRI World Imagery
* Google Hybrid
* Mapbox - your own style
* Mapbox Satellite
* Planet PlanetScope monthly visual basemap (via NICFI)
* Protomaps (with OpenStreetMap data)

To use these services, you are responsible for providing an API token as needed. You may also consult the terms of service and API limitations for each service below.

Please note that depending on your bounding box and maximum zoom level, this tool has the capability to send a lot of requests. You should first use a tool like the [Mapbox offline tile count estimator](https://docs.mapbox.com/playground/offline-estimator/) to ensure that your request will be reasonable, and in the case of any sources with an API limit, won't end up costing you.

## Usage

This tool can be used in the following ways:

* Via CLI (Node.js or Docker)
* Using a [Github template](https://github.com/digidem/map-template) to generate tiles using a `manifest.json`.
* As a task worker service to poll a queue for new requests. 
  * Currently supported: Azure Storage Queue. 
  * The tool may be extended with RabbitMQ for self-hosting in the future.

## CLI options

* `-s` or `--style`: Specify the style source. Use "self" for a self-provided style or one of the following for an online source: "bing", "esri", "google", "mapbox", "mapbox-satellite", "planet".

If using a self-provided style (`--style self`):
*  `--stylelocation`: Location of your provided map style
*  `--stylesources`: Directory where any local source files (GeoJSON, XYZ directory, MBTiles) specified in your provided style are located

If using an online style (`--style` with any online style name):
*  `-a` or `--overlay`: (Optional) Provide a GeoJSON object for a feature layer to overlay on top of the online source
*  `-k` or `--apikey`: (Optional) API key that may be required for your online source

If using any of the imagery online styles ("bing", "esri", "google", "mapbox-satellite", or "planet"):
* `-O` or `--openstreetmap`: (Optional) Overlay OSM vector data on top of your imagery. Currently mapped: hydrology, roads, and points of interest (with labels). This is a boolean variable; set to "true" if you want to use this.

If your style is `mapbox`:
* `-m` or `--mapboxstyle` in the format `<yourusername>/<styleid>`

If your style is `planet-monthly-visual`:
* `-p` or `--monthyear`: The month and year (in YYYY-MM format) of the Planet Monthly Visual Basemap to use

Common options:
*  `-b` or `--bounds`: Bounding box in WSEN format, comma separated (required)
*  `-z` or `--minzoom`: Minimum zoom level (0 if not provided)
*  `-Z` or `--maxzoom`: Maximum zoom level (required)
*  `-o` or `--outputdir`: Output directory (default "outputs/")
*  `-f` or `--filename`: Name of the output MBTiles file

## CLI example usage

Using a self-provided style:

```bash
node src/cli.js --style self --stylelocation tests/fixtures/alert/style-with-geojson.json --stylesources tests/fixtures/alert/sources --bounds "-79,37,-77,38" -Z 8
```

From an online source (Bing):

```bash
node src/cli.js --style bing --bounds "-79,37,-77,38" --openstreetmap true -Z 8 --apikey YOUR_API_KEY_HERE
```

From an online source (Mapbox):

```bash
node src/cli.js --style mapbox --mapboxstyle YOUR_USERNAME/YOUR_MAPBOX_STYLE_ID --apikey YOUR_API_KEY_HERE --bounds "-79,37,-77,38" -Z 8
```

From an online source (Planet):

```bash
node src/cli.js --style planet --monthyear 2013-12 --openstreetmap true --apikey YOUR_API_KEY_HERE --bounds "-54,3,-53,4" -Z 8

```

Online source (Esri) with GeoJSON overlay:

```bash
node src/cli.js --style esri --apikey YOUR_API_KEY_HERE --bounds "-54,3,-53,4" -Z 8 --overlay '{"type": "FeatureCollection", "features": [{"geometry": {"coordinates": [[[-54.25348208981326, 3.140689896338671], [-54.25348208981326, 3.140600064810259], [-54.253841415926914, 3.140600064810259], [-54.25348208981326, 3.140689896338671]]], "geodesic": false, "type": "Polygon"}, "id": "-603946+34961", "properties": {"month": "09", "year": "2023"}, "type": "Feature"}]}'
```

## Azure Storage Queue example usage

For Azure Storage Queue (and other queue services in the future), mapgl-tile-renderer expects a message with a JSON body, composed of the input options:

```json
{
  "style": "bing",
  "apiKey": "bing-api-key",
  "bounds": "-79,37,-77,38",
  "minZoom": 0,
  "maxZoom": 8,
  "output": "bing"
}
```

## Docker

To run the tool with Docker,  run:

```bash
docker run -it --rm -v "$(pwd)":/app/outputs communityfirst/mapgl-tile-renderer --style "mapbox" --bounds "-79,37,-77,38" -Z 8 --mapboxstyle YOUR_USERNAME/YOUR_MAPBOX_STYLE_ID --apikey YOUR_API_KEY_HERE
```

This automatically pulls the latest image from Docker hub. The `docker run` command is used to execute the mapgl-tile-renderer tool with a set of options that define how the map tiles will be rendered and saved. Here's a breakdown of the command and its variables:

- `-it`: This option ensures that the Docker container runs in interactive mode, allowing you to interact with the command-line interface.
- `--rm`: This option automatically removes the container when it exits, which helps to clean up and save disk space.
- `-v "$(pwd)":/app/outputs`: This mounts the current working directory (`$(pwd)`) to the `/app/outputs` directory inside the container, allowing the container to write the output files to your local file system.
- `communityfirst/mapgl-tile-renderer`: This is the name of the Docker image that contains the mapgl-tile-renderer tool.
Make sure to replace the placeholder values with your actual information before running the command.


To run locally first build the Docker image:

```bash
docker build -t mapgl-tile-renderer .
```

Then run:

```bash
docker run -it --rm -v "$(pwd)":/app/outputs mapgl-tile-renderer --style "mapbox" --bounds "-79,37,-77,38" -Z 8 --mapboxstyle YOUR_USERNAME/YOUR_MAPBOX_STYLE_ID --apikey YOUR_API_KEY_HERE
```

## Tests

To run tests and view coverage, run:

```bash
npm run test
```

To run tests that require a Mapbox or Planet access token, create a `.env.test` file and add MAPBOX_TOKEN and PLANET_TOKEN vars with your own token.

## Inspect the mbtile outputs

Three easy ways to examine and inspect the MBTiles:

1. Upload them to a [Felt](https://felt.com) map.
2. Use the [mbview](https://github.com/mapbox/mbview) tool to view them in the browser.
3. Load them in [QGIS](https://qgis.org).

## Formats other than MBTiles

In the future, we may decide to extend this tool to support creating raster tiles in a different format, such as [PMTiles](https://github.com/protomaps/PMTiles). However, for the time being, you can use tools like [go-pmtiles](https://github.com/protomaps/go-pmtiles) to convert the MBTiles outputs generated by this tool.

## Licensing for online API sources

This tool makes it possible to download tiles from various API sources for offline usage. Here are links to the licensing and API limitations for each source:

1. Bing Satellite: API [Terms of Use](https://www.microsoft.com/en-us/maps/bing-maps/product) and information on [accessing Bing Maps tiles](https://learn.microsoft.com/en-us/bingmaps/rest-services/directly-accessing-the-bing-maps-tiles)
2. Esri World Imagery (for Export): [Terms of use](https://www.arcgis.com/home/item.html?id=226d23f076da478bba4589e7eae95952)
3. Google Hybrid: API [Terms of Use](https://developers.google.com/maps/documentation/tile/policies)
4. Mapbox: Raster Tiles API [Pricing](https://www-mapbox.webflow.io/pricing#tile)
5. Planet Basemaps API [Overview](https://developers.planet.com/docs/basemaps/tile-services/)
6. Protomaps API [FAQ](https://protomaps.com/faq)
