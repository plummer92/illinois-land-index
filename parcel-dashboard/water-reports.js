(() => {
  const chathamReport = "https://www.chathamil.gov/files/manual/2302/2025ChathamCCR.pdf";
  const springfieldReport = "https://www.cwlp.com/Departments/WaterDeptHome/WaterDocuments/WQR2025.pdf";
  const auburnReport = "https://auburnillinois.us/files/manual/2294/Auburn%20CCR%202025.pdf";
  const rochesterReport = "https://www.ilrwa.org/CCR/Rochester.pdf";
  const watershedPlan = "https://epa.illinois.gov/content/dam/soi/en/web/epa/documents/water-quality/watershed-management/watershed-based-planning/2018/lake-springfield/lswmp-wbmp.pdf#page=79";
  const reports = {
    IL1670050: {
      source: auburnReport,
      linkLabel: "Read Auburn’s 2025 water report (PDF)",
      findings: [
        "Auburn found haloacetic acids, which form during disinfection, at 26 to 53 parts per billion. The city reported no violation of the 60 parts per billion limit.",
        "Auburn listed two violations for failing to give customers an adequate annual water report. Both ran from July 1 through December 2, 2025."
      ]
    },
    IL1671000: {
      source: rochesterReport,
      linkLabel: "Read Rochester’s 2025 water report (PDF)",
      findings: [
        "Rochester reported no violations in its own system. Lead ranged from undetected to 8.18 parts per billion at the taps sampled. None exceeded the report’s action level of 15 parts per billion.",
        "The village’s supplier, Springfield CWLP, received a monitoring violation. Its lab used an unapproved test for the herbicide atrazine during the July–September quarter."
      ]
    },
    IL1670300: {
      source: chathamReport,
      linkLabel: "Read Chatham’s 2025 water report (PDF)",
      findings: [
        "Chatham sampled 30 taps for lead. The highest result was 5.97 parts per billion. None exceeded the report’s action level of 15 parts per billion. Lead levels can vary with a home’s plumbing.",
        "The South Sangamon Water Commission, Chatham’s regular supplier, measured nitrate at 0.28 parts per million in treated water. The limit was 10 parts per million."
      ]
    },
    IL1671200: {
      source: springfieldReport,
      linkLabel: "Read Springfield’s 2025 water report and monitoring notice (PDF)",
      findings: [
        "CWLP reported no violations of contaminant limits. Its highest nitrate result was 0.38 parts per million. The limit was 10 parts per million.",
        "CWLP did receive a monitoring violation. Its lab used an unapproved test for the herbicide atrazine in August, so the required July–September result could not be verified."
      ]
    }
  };

  // Lake point lies inside the project's USGS waterbody polygon. The groundwater
  // point uses the approximate area of the commission's public Buckhart Road plant.
  const lake = {
    id: "lake-springfield",
    name: "Lake Springfield",
    kind: "water",
    lon: -89.603,
    lat: 39.713
  };
  const sites = {
    IL1670050: [
      {
        id: "otter-lake", name: "Otter Lake", kind: "water", role: "normal",
        lon: -89.899, lat: 39.420,
        note: "The Otter Lake Water Commission draws surface water from this reservoir and sells treated water to Auburn. The marker shows the lake.",
        sourceUrl: auburnReport + "#page=2", sourceLabel: "Auburn’s water source, p. 2 (PDF)"
      }
    ],
    IL1671000: [
      {
        ...lake, role: "normal",
        note: "Rochester buys drinking water from Springfield CWLP, which draws from Lake Springfield. The marker shows the reservoir.",
        sourceUrl: rochesterReport, sourceLabel: "Rochester’s water source, p. 1 (PDF)"
      }
    ],
    IL1670300: [
      {
        id: "south-sangamon-groundwater", name: "South Sangamon groundwater", kind: "water", role: "normal",
        lon: -89.47, lat: 39.75,
        note: "Chatham’s regular supply comes from groundwater in the Sangamon River aquifer east of Rochester. The marker shows the general source area.",
        sourceUrl: watershedPlan, sourceLabel: "Lake Springfield watershed plan, pp. 55–56 (PDF)"
      },
      {
        ...lake, role: "backup",
        note: "Chatham can buy treated Lake Springfield water from CWLP during a water emergency. The marker shows the reservoir.",
        sourceUrl: chathamReport + "#page=5", sourceLabel: "Chatham’s emergency supply, p. 5 (PDF)"
      }
    ],
    IL1671200: [
      {
        ...lake, role: "normal",
        note: "CWLP draws its regular drinking water from Lake Springfield. The marker shows the reservoir.",
        sourceUrl: springfieldReport + "#page=2", sourceLabel: "Springfield’s water source, p. 2 (PDF)"
      }
    ]
  };

  window.propertyWaterSites = function (waterSystemId) {
    return Object.hasOwn(sites, waterSystemId) ? sites[waterSystemId] : [];
  };

  window.addWaterReport = function (container, waterSystemId) {
    if (!Object.hasOwn(reports, waterSystemId)) return false;
    const report = reports[waterSystemId];
    const section = document.createElement("section");
    section.className = "water-report";
    const heading = document.createElement("h5");
    heading.textContent = "2025 drinking water quality";
    section.append(heading);
    for (const finding of report.findings) {
      const paragraph = document.createElement("p");
      paragraph.textContent = finding;
      section.append(paragraph);
    }
    const link = document.createElement("a");
    link.textContent = report.linkLabel;
    link.href = report.source;
    link.referrerPolicy = "no-referrer";
    section.append(link);
    container.append(section);
    return true;
  };
})();
