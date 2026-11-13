(() => {
  // Plant points are from the U.S. EIA September 2026 operating generator
  // inventory. The linked utility sources document each supply relationship.
  const imeaCoal = "https://www.imea.org/IMEA%20Power%20Resources-Coal.html";
  const imeaWind = "https://www.imea.org/IMEA%20Power%20Resources-Wind.html";
  const imeaHydro = "https://www.imea.org/IMEA%20Power%20Resources-Hydro.html";
  const imeaSolar = "https://www.imea.org/News%20Full%20Story.asp?StoryID=36";
  const cwlp = "https://www.cwlp.com/departments/electricdepthome/electricinformation/generation.aspx";
  function plant(id, name, lon, lat, note, sourceUrl, sourceLabel) {
    return {id, name, kind:"power", role:"portfolio", lon, lat, note, sourceUrl, sourceLabel};
  }
  const imeaPlants = [
    plant("prairie-state", "Prairie State Generating Station", -89.66694, 38.279167,
      "Coal near Marissa, Illinois. IMEA owns a 15.17% share of the station’s two units.", imeaCoal, "IMEA coal plants"),
    plant("green-river-wind", "Green River Wind Farm", -89.55703, 41.620264,
      "Wind farm in Lee and Whiteside counties, Illinois. IMEA contracted for 50 megawatts of its output.", imeaWind, "IMEA wind contracts"),
    plant("lee-dekalb-wind", "Lee/DeKalb Wind Energy Center", -88.8867, 41.7678,
      "Wind farm in Lee and DeKalb counties, Illinois. IMEA contracted for 70 megawatts of its output.", imeaWind, "IMEA wind contracts"),
    plant("big-river-solar", "Big River Solar", -88.29553, 38.050141,
      "Solar farm in White County, Illinois. IMEA began receiving 25 megawatts under a ten-year agreement in June 2025. The agreement excludes renewable energy credits.", imeaSolar, "IMEA solar purchase agreement"),
    plant("rock-falls-hydro", "Rock Falls hydroelectric plant", -89.67753, 41.787115,
      "On the Rock River in Illinois. The City of Rock Falls owns this 2-megawatt plant and contributes power to IMEA’s supply.", imeaHydro, "IMEA hydropower"),
    plant("peru-hydro", "Peru hydroelectric plant", -88.98117, 41.321861,
      "On the Illinois River in LaSalle County. The City of Peru owns this 7.6-megawatt plant and contributes power to IMEA’s supply.", imeaHydro, "IMEA hydropower"),
    plant("trimble-county", "Trimble County Generating Station", -85.4117, 38.5847,
      "Coal in Trimble County, Kentucky. IMEA co-owns Units 1 and 2.", imeaCoal, "IMEA coal plants")
  ];
  const springfieldPlants = [
    plant("dallman-4", "Dallman Unit 4", -89.60239, 39.754803,
      "Coal at Lake Springfield. CWLP says Unit 4 produced 94% of the electricity its own plants generated in 2025.", cwlp, "CWLP generation records"),
    plant("interstate", "Interstate peaking plant", -89.5891, 39.8233,
      "Springfield. CWLP uses this natural gas and oil turbine when more generating capacity is needed.", cwlp, "CWLP generation records"),
    plant("factory", "Factory peaking plant", -89.63728, 39.825934,
      "Springfield. This oil-fired CWLP turbine can supply power when demand is high.", cwlp, "CWLP generation records"),
    plant("reynolds", "Reynolds peaking plant", -89.64165, 39.806868,
      "Springfield. This oil-fired CWLP turbine can supply power when demand is high.", cwlp, "CWLP generation records")
  ];
  window.propertyPowerSites = function(provider) {
    if (provider === "imea") return imeaPlants;
    if (provider === "cwlp") return springfieldPlants;
    return [];
  };

  const amerenTariff = "https://www.ameren.com/-/media/rates/illinois/residential/gas-rates/general-information/aigs2otcvc.ashx";
  const amerenCheck = "https://www.ameren.com/service/convert-to-gas";
  const gasUtilities = "https://icc.illinois.gov/authority/natural-gas-utility";
  const amerenPages = {
    Berlin:1, Buffalo:7, Cantrall:1, Chatham:5, Curran:5, Dawson:7, Grandview:5, Illiopolis:8,
    Jerome:5, "Leland Grove":5, Loami:3, Mechanicsburg:9, "New Berlin":3, "Pleasant Plains":4,
    Rochester:5, Sherman:6, "Southern View":6, Spaulding:6, Springfield:6, Williamsville:6
  };
  const municipalGas = {
    Auburn:["City of Auburn", "https://auburnillinois.us/departments-developments"],
    Divernon:["Village of Divernon", "https://divernonil.gov/community/public-works-department/"],
    Pawnee:["Village of Pawnee", "https://pawneeil.net/residents/services/utilities/"],
    Riverton:["Village of Riverton", "https://riverton.illinois.gov/Public-Works"]
  };
  const libertyCommunities = ["Thayer","Virden"];
  const libertyTariff = "https://illinois.libertyutilities.com/uploads/Liberty_Illinois_Tariff.pdf";
  function element(tag, content) {
    const node = document.createElement(tag);
    node.textContent = content;
    return node;
  }
  function link(label, url) {
    const node = element("a",label);
    node.href = url;
    node.referrerPolicy = "no-referrer";
    return node;
  }
  function showUnconfirmed(card, message) {
    card.append(element("p",message),link("Illinois gas utility directory",gasUtilities));
  }
  let communityRequest;
  function loadCommunities() {
    if (!communityRequest) {
      communityRequest = fetch("./data/sangamon-gas-communities.json").then(async response => {
        if (!response.ok) throw new Error("Municipal map unavailable");
        return (await response.json()).communities;
      }).catch(error => { communityRequest = null; throw error; });
    }
    return communityRequest;
  }
  function showCommunity(card, {name,geometry}) {
    const page = amerenPages[name];
    let supplier;
    if (page) {
      supplier = {provider:"Ameren Illinois",sourceUrl:amerenTariff + "#page=" + page,sourceLabel:"Ameren’s list of communities"};
      card.append(element("p","Ameren’s gas service schedule lists " + name + ". A gas bill or Ameren can confirm whether this property has a meter."),
        link(supplier.sourceLabel,supplier.sourceUrl),
        document.createTextNode(" · "),link("Ask Ameren about this address",amerenCheck));
    } else if (municipalGas[name]) {
      const [provider, url] = municipalGas[name];
      supplier = {provider,sourceUrl:url,sourceLabel:name + " utility information"};
      card.append(element("p",provider + " operates a local gas system. The municipal utility office can confirm whether this property is connected."),
        link(supplier.sourceLabel,supplier.sourceUrl));
    } else if (libertyCommunities.includes(name)) {
      supplier = {provider:"Liberty Utilities",sourceUrl:libertyTariff,sourceLabel:"Liberty’s Illinois gas service schedule"};
      card.append(element("p","Liberty’s Illinois gas service schedule lists " + name + ". A gas bill or the utility can identify the delivery company at this address."),
        link(supplier.sourceLabel,supplier.sourceUrl));
    } else {
      showUnconfirmed(card,"We haven’t matched this community to a gas provider. Check the delivery company on a gas bill for this address.");
      return;
    }
    return {community:name,geometry,...supplier};
  }
  window.showPropertyGas = async function(parent, {lon,lat} = {}, within, onMatch) {
    const card = document.createElement("div");
    parent.replaceChildren(card);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || typeof within !== "function" ||
        lon < -90 || lon > -89.2 || lat < 39.5 || lat > 40) {
      showUnconfirmed(card,"This lookup matches incorporated communities in Sangamon County. A gas bill or the local utility can confirm service at this address.");
      onMatch?.(null,"No mapped community");
      return;
    }
    const status = element("p","Checking the community for gas service…");
    card.append(status);
    try {
      const communities = await loadCommunities();
      const matches = communities.filter(({bounds,geometry}) => {
        const [west,south,east,north] = bounds;
        return lon >= west && lon <= east && lat >= south && lat <= north && within(lon,lat,geometry);
      });
      status.remove();
      if (matches.length === 1) {
        const match = showCommunity(card,matches[0]);
        onMatch?.(match,match ? "Community match only" : "Provider unconfirmed");
      }
      else {
        showUnconfirmed(card, matches.length
          ? "More than one municipal boundary matches this property point. A gas bill can confirm the delivery company."
          : "This point is outside the mapped communities. Nearby gas utilities may serve individual addresses. Check the delivery company on your gas bill, if you have one.");
        onMatch?.(null,matches.length ? "Overlapping communities" : "No mapped community");
      }
    } catch {
      status.remove();
      showUnconfirmed(card,"The community map could not load. Check your gas bill for the delivery company.");
      onMatch?.(null,"Community map unavailable");
      const retry = element("button","Try the gas lookup again");
      retry.type = "button";
      retry.addEventListener("click",() => window.showPropertyGas(parent,{lon,lat},within,onMatch));
      card.append(retry);
    }
  };
})();
