export const boundaryColor = "#50516a";

export function publishedBoundaries(data) {
  return (data?.type === "FeatureCollection" && Array.isArray(data.features) ? data.features : [])
    .filter(feature => feature?.type === "Feature" && feature.properties?.source
      && feature.geometry?.type === "LineString" && Array.isArray(feature.geometry.coordinates)
      && feature.geometry.coordinates.length > 1 && feature.geometry.coordinates.every(point =>
        Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
        && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90));
}
