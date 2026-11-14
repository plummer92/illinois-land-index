(function () {
  const analytics = window.landIndexAnalytics;
  const status = document.getElementById("preference-status");
  const detail = document.getElementById("preference-detail");
  const exclude = document.getElementById("exclude");
  const include = document.getElementById("include");
  if (!analytics) {
    status.textContent = "Preferences could not load";
    detail.textContent = "Please reload this page before continuing.";
    exclude.disabled = true;
    return;
  }
  function render() {
    const state = analytics.getStatus();
    status.textContent = state.excluded ? (state.remembered ? "Your visits are excluded in this browser" : "This visit is excluded") : "Your visits are included";
    detail.textContent = state.excluded
      ? (state.remembered ? "Saved. You can use the site normally without adding to its audience totals." : "Your browser could not save this preference. It may count future visits. Allow site storage and try again.")
      : "Future visits to the public site can appear in its audience totals.";
    exclude.hidden = state.excluded && state.remembered;
    include.hidden = !state.excluded;
  }
  exclude.addEventListener("click", () => { analytics.setExcluded(true); render(); });
  include.addEventListener("click", () => {
    analytics.setExcluded(false);
    if (window.location.hash === "#exclude") window.history.replaceState(null, "", window.location.pathname);
    render();
  });
  render();
})();
