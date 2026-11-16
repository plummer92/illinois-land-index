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

  function dateText(value) {
    const day = typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!day) return null;
    const parsed = new Date(day + "T12:00:00Z");
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== day) return null;
    return parsed.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric", timeZone:"UTC"});
  }

  function scoreWarning({row, parcel = {}, scoreData = {}, acreageCheck}) {
    if (!row) return null;
    const checked = acreageCheck?.model_version === scoreData.model_version ? acreageCheck?.parcels?.[row[0]] : null;
    if (!positive(row[3])) {
      if (checked?.status === "conflict") return {
        title:"Conflicting lot-size records affect this score",
        detail:"No acreage passed the record checks. The published score loses acreage-related points and includes a missing-acreage deduction. This is a data limitation, not a finding about your home."
      };
      return {
        title:"This score uses incomplete lot-size data",
        detail:(positive(parcel.acres) ? "This county lookup supplies " + acres(parcel.acres) + ", but the published score still has no usable acreage. " : "The scoring record has no usable acreage. ") +
          "The model awards no acreage or per-acre points and applies a missing-acreage deduction. This is a data limitation, not a finding about your home."
      };
    }
    if (positive(parcel.acres) && Math.abs(parcel.acres - row[3]) > .0005) return {
      title:"Lot-size records differ",
      detail:"This lookup shows " + acres(parcel.acres) + "; the published score used " + acres(row[3]) + ". The score has not been recalculated from this lookup."
    };
    return null;
  }

  function provenance({row, loaded, sourceDate, parcel = {}, entry, pending = false, scoreData = {}, acreageCheck}) {
    const records = [];
    const countyMap = "https://sangis.co.sangamon.il.us/server/rest/services/TyleratENTParcels/MapServer/0";
    const checked = acreageCheck?.model_version === scoreData.model_version ? acreageCheck?.parcels?.[row?.[0]] : null;
    const taxDate = dateText(sourceDate), calculated = dateText(scoreData.calculated_at);
    records.push({label:"Score", status:row ? "Research model" : loaded ? "Not scored" : "Unavailable",
      source:"Illinois Land Index", date:row ?
        (taxDate ? "Tax file: " + taxDate : "Tax-file date unavailable") + " · " +
        (calculated ? "Calculated: " + calculated + " (UTC)" : "Calculation date unavailable") :
        loaded ? "No entry in this scoring snapshot" : "Scoring file could not load",
      href:"../data/sangamon-parcel-scores.json"});
    const withheld = checked?.status === "conflict" && !positive(row?.[3]);
    const fromGis = positive(parcel.acres) && !withheld;
    const fromScore = positive(row?.[3]);
    const recovered = checked?.status === "recovered" && fromScore && Math.abs(checked.acres - row[3]) < .0005;
    const gisDate = dateText(parcel.gisCheckedAt), auditDate = dateText(acreageCheck?.checked_at_utc);
    records.push({label:"Lot size", status:fromGis || fromScore ? "County record" : withheld ? "Conflicting records" : pending ? "Checking" : "Not verified",
      source:fromGis || recovered || checked ? "Sangamon County GIS" : "County tax snapshot",
      date:fromGis ? (gisDate ? "Retrieved: " + gisDate + " (UTC)" : "Lookup date unavailable") + " · Source update date unavailable" :
        recovered || checked ? (auditDate ? "Checked: " + auditDate + " (UTC)" : "Check date unavailable") + " · Source update date unavailable" :
        fromScore ? (taxDate ? "Tax file: " + taxDate : "Tax-file date unavailable") : "No usable recorded lot size",
      href:fromGis || recovered || checked ? countyMap : "../data/sangamon-parcel-scores.json"});
    const matching = (parcel.features || []).filter(feature => String(feature.properties?.PIN) === parcel.pin);
    const liveOutline = matching.some(feature => outline(feature.geometry));
    const snapshotOutline = Boolean(entry?.d);
    const locationOnly = point(entry?.pt) || point(parcel.position) || matching.some(feature => feature.geometry?.type === "Point" && point(feature.geometry.coordinates));
    records.push({label:"Map", status:snapshotOutline || liveOutline ? "County GIS outline" : locationOnly ? "Location point only" : pending ? "Checking" : "Not verified",
      source:"Sangamon County GIS", date:snapshotOutline || (!liveOutline && entry) ? "Boundary retrieval and update dates unavailable" :
        liveOutline || locationOnly ? (gisDate ? "Retrieved: " + gisDate + " (UTC)" : "Retrieval date unavailable") + " · Source update date unavailable" :
        pending ? "County lookup in progress" : parcel.geometryUnavailable ? "County lookup could not finish" : "No usable map location returned",
      href:countyMap});
    return records;
  }

  function validateReasons(source, row, sourceDate, modelVersion) {
    if (!source || source.source_date !== sourceDate || !Array.isArray(source.patterns) || !source.rows) return null;
    if (modelVersion && source.model_version !== modelVersion) return null;
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

  function facts({row, loaded, sourceDate, propertyClass, parcel = {}, entry, pending = false, scoreData = {}, acreageCheck}) {
    const result = [];
    const checked = acreageCheck?.model_version === scoreData.model_version ? acreageCheck?.parcels?.[row?.[0]] : null;
    const checkedDate = acreageCheck?.checked_at_utc?.slice(0,10);
    const calculation = scoreData.calculated_at ? " Recalculated " + scoreData.calculated_at.slice(0,10) + " (UTC) after the residential-rule correction and a county GIS acreage check." : "";
    result.push({label:"Scoring record", status:row ? "Recorded" : loaded ? "Not scored" : "Could not load", detail:row ?
      propertyClass + ". The base tax record is dated " + sourceDate + "; these are not live tax or sale records." + calculation : loaded ?
      "No entry in the published scoring list. This does not mean the county has no property record." :
      "Reload to try the scoring file again. County lookup and scoring coverage are separate."});

    const withheld = checked?.status === "conflict" && !positive(row?.[3]);
    const fromGis = positive(parcel.acres) && !withheld, fromScore = positive(row?.[3]);
    let detail = fromGis ? acres(parcel.acres) + " from this county GIS lookup." :
      fromScore ? acres(row[3]) + " in the scoring snapshot dated " + sourceDate + "." :
      (withheld ? "No acreage passed the record checks for this score." : "No positive acreage is recorded in the available result.") + " This does not establish that the lot has zero area.";
    if (checked?.status === "recovered" && fromScore && Math.abs(checked.acres - row[3]) < .0005) {
      detail = acres(row[3]) + " used in the recalculated score, recovered from the county GIS recorded-acreage field (TOTACRES), checked " + checkedDate + " (UTC). It passed a comparison with the mapped parcel area; no map-area estimate was used as the lot size. The county does not supply an update date for that field.";
      if (fromGis) detail += " This lookup returned " + acres(parcel.acres) + ".";
    } else if (checked) {
      detail += checked.status === "conflict" ? " The GIS check on " + checkedDate + " found conflicting recorded acreages or a mismatch with the parcel footprint; none was used to recalculate the score." :
        checked.status === "no_match" ? " The GIS check on " + checkedDate + " found no exact parcel-number match in the three county layers checked." :
        " The GIS check on " + checkedDate + " found this parcel but no usable positive recorded acreage.";
    }
    if (withheld && positive(parcel.acres)) detail += " This lookup returned " + acres(parcel.acres) + ", but the conflicting GIS size is withheld from the lot-size display and score pending clarification.";
    if (fromGis && row && (!fromScore || Math.abs(parcel.acres - row[3]) > .0005)) {
      detail += fromScore ? " The score used " + acres(row[3]) + ". These sources differ; the score has not been recalculated." :
        " The score used no positive acreage, even though GIS now supplies a size. The score has not been recalculated.";
    } else if (!fromGis && fromScore && parcel.geometryUnavailable) {
      detail += " The county GIS lookup could not refresh it.";
    }
    if (row && !fromScore) detail += " The model awarded no acreage or per-acre points and applied its missing-acreage deduction.";
    result.push({label:"Lot size", status:fromGis || fromScore ? "Recorded" : checked?.status === "conflict" ? "Conflicting records" : pending ? "Checking" : "Missing", detail});

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

  window.ParcelScoreContext = {interpretation, validateReasons, facts, scoreWarning, provenance};
})();
