(() => {
  const form = document.getElementById("home-property-form");
  const input = document.getElementById("home-property-query");
  const fallback = document.getElementById("home-find-link");
  const key = "ili-property-query";
  // Only offer the form when this tab can hand the query to the dashboard privately.
  try {
    sessionStorage.setItem(key, "");
    sessionStorage.removeItem(key);
  } catch {
    return;
  }
  form.hidden = false;
  fallback.hidden = true;
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      sessionStorage.setItem(key, input.value.trim());
    } catch {
      // Visitors can still enter their query on the dashboard.
    }
    location.assign(form.action);
  });
})();
