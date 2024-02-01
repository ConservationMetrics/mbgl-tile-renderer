import fs from "fs";
import path from "path";
import axios from "axios";
import pLimit from "p-limit";

import {
  convertCoordinatesToTiles,
  validateMinMaxValues,
} from "./tile_calculations.js";

// Download XYZ tile
const downloadOnlineXyzTile = async (style, xyzUrl, filename, apiKey) => {
  if (fs.existsSync(filename)) return false;

  const config = { responseType: "arraybuffer" };

  if (style === "planet") {
    // Use HTTP Basic Authentication for Planet API
    config.auth = {
      username: apiKey,
      password: "", // Password should be empty, per documentation https://developers.planet.com/docs/basemaps/tile-services/
    };
  } else if (apiKey) {
    // For other sources, use Bearer token if apiKey is provided
    config.headers = { Authorization: `Bearer ${apiKey}` };
  }

  try {
    const response = await axios.get(xyzUrl, config);
    if (response.status === 200) {
      fs.writeFileSync(filename, response.data);
      return true; // Return true if download was successful
    } else {
      console.warn(
        `Failed to download: ${xyzUrl} (Status code: ${response.status})`,
      );
      return false;
    }
  } catch (error) {
    console.error(`\x1b[33mError downloading tile: ${xyzUrl}\x1b[0m`, error);
    return false;
  }
};

// Download XYZ tiles from a given source
const downloadOnlineTiles = async (
  style,
  apiKey,
  mapboxStyle,
  monthYear,
  bounds,
  minZoom,
  maxZoom,
  tempDir,
) => {
  if (!bounds || bounds.length < 4) {
    throw new Error("Invalid bounds provided");
  }

  let imageryUrl, imageryAttribution, imagerySourceName;
  switch (style) {
    case "google":
      imageryUrl = `https://mt0.google.com/vt?lyrs=s&x={x}&y={y}&z={z}`;
      imageryAttribution = "© Google";
      imagerySourceName = "Google Hybrid";
      break;
    case "esri":
      imageryUrl =
        "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      imageryAttribution = "© ESRI";
      imagerySourceName = "ESRI World Imagery";
      break;
    case "bing":
      imageryUrl = "http://ecn.t3.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1";
      imageryAttribution = "© Microsoft (Bing Maps)";
      imagerySourceName = "Bing Maps Satellite";
      break;
    case "mapbox":
      imageryUrl = `https://api.mapbox.com/styles/v1/${mapboxStyle}/tiles/{z}/{x}/{y}?access_token=${apiKey}`;
      imageryAttribution = "© Mapbox";
      imagerySourceName = "Mapbox Custom Style";
      break;
    case "mapbox-satellite":
      imageryUrl = `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${apiKey}`;
      imageryAttribution = "© Mapbox";
      imagerySourceName = "Mapbox Satellite";
      break;
    case "planet":
      imageryUrl = `https://tiles.planet.com/basemaps/v1/planet-tiles/planet_medres_visual_${monthYear}_mosaic/gmap/{z}/{x}/{y}?api_key=${apiKey}`;
      imageryAttribution = "© Planet Labs";
      imagerySourceName = `Planet Planetscope Monthly Visual Basemap, ${monthYear} (made available through NICFI)`;
      break;
    default:
      console.error("Invalid source provided");
      return;
  }

  const xyzOutputDir = `${tempDir}/sources`;
  if (!fs.existsSync(xyzOutputDir)) {
    fs.mkdirSync(xyzOutputDir, { recursive: true });
  }

  console.log(`Downloading raster XYZ tiles from ${imagerySourceName}...`);

  const limit = pLimit(5);

  let totalTileCount = 0;

  // Iterate over zoom levels and tiles
  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    let { x: minX, y: maxY } = convertCoordinatesToTiles(
      bounds[0],
      bounds[1],
      zoom,
    );
    let { x: maxX, y: minY } = convertCoordinatesToTiles(
      bounds[2],
      bounds[3],
      zoom,
    );

    validateMinMaxValues(minX, maxX, minY, maxY);

    let tileCount = 0;

    let promises = [];

    for (let col = minX; col <= maxX; col++) {
      for (let row = minY; row <= maxY; row++) {
        let xyzUrl;
        if (style === "bing") {
          // Adapted from Microsoft's Bing Maps Tile System documentation:
          // https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system
          // Calculate quadkey for Bing
          let quadkey = "";
          // Treat zoom 0 as 1, since Bing doesn't support zoom 0
          if (zoom === 0) zoom = 1;
          for (let i = zoom; i > 0; i--) {
            let digit = 0;
            const mask = 1 << (i - 1);
            if ((col & mask) !== 0) digit += 1;
            if ((row & mask) !== 0) digit += 2;
            quadkey += digit.toString();
          }
          xyzUrl = imageryUrl.replace("{q}", quadkey);
        } else {
          xyzUrl = imageryUrl
            .replace("{z}", zoom)
            .replace("{x}", col)
            .replace("{y}", row);
        }

        const filename = path.join(
          xyzOutputDir,
          `${zoom}`,
          `${col}`,
          `${row}.jpg`,
        );

        if (!fs.existsSync(path.dirname(filename))) {
          fs.mkdirSync(path.dirname(filename), { recursive: true });
        } else {
          totalTileCount++;
          console.log(`File already exists: ${filename}`);
          continue;
        }

        promises.push(
          limit(() => downloadOnlineXyzTile(style, xyzUrl, filename, apiKey)),
        );
      }
    }
    const results = await Promise.all(promises);

    tileCount = results.filter((result) => result).length;
    totalTileCount += tileCount;

    // There may be edge cases in which no tiles are downloaded for a specific zoom level
    // For example, if the tile already exists in the temp dir from a previous download
    // attempt, or if we encounter rate limiting, or if one of the APIs does not return tiles
    // for a specific zoom level for some unforeseen reason. We might still want to continue
    // generating an MBTiles in that case, so we log a warning instead of throwing an exception.
    if (tileCount === 0) {
      console.warn(`\x1b[33mNo tiles downloaded for zoom level ${zoom}\x1b[0m`);
    } else {
      console.log(`Zoom level ${zoom} downloaded with ${tileCount} tiles`);
    }
  }

  // We definitely do *not* want to proceed if no tiles were downloaded at all.
  if (totalTileCount === 0) {
    throw new Error("No tiles downloaded");
  } else {
    console.log(`Total tiles downloaded: ${totalTileCount}`);
  }

  // Save metadata.json file with proper attribution according to
  // each source's terms of use
  const metadata = {
    name: imagerySourceName,
    description: `Raster XYZ tiles from ${imagerySourceName}`,
    version: "1.0.0",
    attribution: imageryAttribution,
    format: "jpg",
    type: "overlay",
  };

  const metadataFilePath = path.join(xyzOutputDir, "metadata.json");

  try {
    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, 4));
    console.log("Metadata file generated!");
  } catch (error) {
    throw new Error(`Error writing metadata file: ${metadataFilePath}`);
  }

  console.log(
    `\x1b[32mXYZ tiles successfully downloaded from ${imagerySourceName}!\x1b[0m`,
  );
};

// Handler for requesting tiles from different online sources
export const requestOnlineTiles = (
  style,
  apiKey,
  mapboxStyle,
  monthYear,
  bounds,
  minZoom,
  maxZoom,
  tempDir,
) => {
  return new Promise(async (resolve, reject) => {
    try {
      await downloadOnlineTiles(
        style,
        apiKey,
        mapboxStyle,
        monthYear,
        bounds,
        minZoom,
        maxZoom,
        tempDir,
      );
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
