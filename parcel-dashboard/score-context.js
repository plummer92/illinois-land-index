(() => {
  "use strict";
  const positive = value => Number.isFinite(value) && value > 0;
  const acres = value => new Intl.NumberFormat("en-US", {maximumFractionDigits:3}).format(value) + " acres";
  const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  function polygon(rings) {
    if (!Array.isArray(rings) || !rings.length || !rings.every(ring => Array.isArray(ring) &&
      ring.length >= 4 && ring.every(point) && ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1])) return false;
    const outer = rings[0];
    return new Set(outer.map(vertex => vertex[0])).size > 1 && new Set(outer.map(vertex => vertex[1])).size > 1;
  }
  function outline(geometry) {
    return geometry?.type === "Polygon" ? polygon(geometry.coordinates) : geometry?.type === "MultiPolygon" &&
      Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(polygon);
  }

  function interpretation(row, loaded) {
    if (!row) return loaded ?
      "This parcel is outside the published scoring list. No score is different from a score of zero." :
      "The scoring file could not load. The score is unknown; this is not a score of zero.";
    return "This is a land-research priority, not a grade for your home. Farms and larger lots usually score higher. A low score does not mean a home is unsafe, poorly maintained or worth less.";
  }

  function validateReasons(source, row, sourceDate) {
    if (!source || source.source_date !== sourceDate || !Array.isArray(source.patterns) || !source.rows) return null;
    const index = source.rows[row[0]];
    if (!Number.isInteger(index)) return null;
    const values = source.patterns[index];
    if (!Array.isArray(values) || values.length !== 9 || !values.every(Number.isInteger)) return null;
    const [land, size, assessment, tax, ownership, holdings, otherBuy, propertyRisk, otherRisk] = values;
    const bound = (value, max) => Math.min(max, Math.max(0, value));
    return bound(land + size + assessment + tax, 40) === row[4] &&
      bound(ownership + holdings + otherBuy, 35) === row[5] &&
      bound(25 + propertyRisk + otherRisk, 25) === row[6] &&
      row[4] + row[5] + row[6] === row[7] ? values : null;
  }

  function facts({row, loaded, sourceDate, propertyClass, parcel = {}, entry, pending = false}) {
    const result = [];
    result.push({label:"Scoring record", status:row ? "Recorded" : loaded ? "Not scored" : "Could not load", detail:row ?
      propertyClass + ". Score and scoring inputs use the county file dated " + sourceDate + "; they are not live tax or sale records." : loaded ?
      "No entry in the published scoring list. This does not mean the county has no property record." :
      "Reload to try the scoring file again. County lookup and scoring coverage are separate."});

    const fromGis = positive(parcel.acres), fromScore = positive(row?.[3]);
    let detail = fromGis ? acres(parcel.acres) + " from this county GIS lookup." :
      fromScore ? acres(row[3]) + " in the scoring snapshot dated " + sourceDate + "." :
      "No positive acreage is recorded in the available result. This does not establish that the lot has zero area.";
    if (fromGis && row && (!fromScore || Math.abs(parcel.acres - row[3]) > .0005)) {
      detail += fromScore ? " The score used " + acres(row[3]) + ". These sources differ; the score has not been recalculated." :
        " The score used no positive acreage, even though GIS now supplies a size. The score has not been recalculated.";
    } else if (!fromGis && fromScore && parcel.geometryUnavailable) {
      detail += " The county GIS lookup could not refresh it.";
    }
    if (row && !fromScore) detail += " The model awarded no acreage or per-acre points and applied its missing-acreage deduction.";
    result.push({label:"Lot size", status:fromGis || fromScore ? "Recorded" : pending ? "Checking" : "Missing", detail});

    const matching = (parcel.features || []).filter(feature => String(feature.properties?.PIN) === parcel.pin);
    const liveOutline = matching.some(feature => outline(feature.geometry));
    const snapshotOutline = Boolean(entry?.d);
    const locationOnly = point(entry?.pt) || point(parcel.position) || matching.some(feature => feature.geometry?.type === "Point" && point(feature.geometry.coordinates));
    result.push({label:"Lot boundary", status:snapshotOutline || liveOutline ? "Mapped" : locationOnly ? "Point only" : pending ? "Checking" : parcel.geometryUnavailable ? "Could not load" : "Missing", detail:
      snapshotOutline ? "Stored county GIS outline, not a boundary survey. This map file does not record a separate boundary retrieval date." :
      liveOutline ? "County GIS outline returned by this lookup, not a boundary survey." :
      locationOnly ? "A county location point is available, but no lot outline. The point does not show the property limits." :
      pending ? "Waiting for county GIS. Missing map data does not lower the published score." :
      parcel.geometryUnavailable ? "County GIS could not be reached or its response was incomplete. This is a lookup failure, not evidence that no boundary exists." :
      "No outline or usable location was returned. Check the county map. Missing map data does not lower the published score."});
    return result;
  }

  window.ParcelScoreContext = {interpretation, validateReasons, facts};
})();
