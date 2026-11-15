(() => {
  "use strict";

  // A shared property link contains only its public parcel number. Rebuild it
  // from a fixed base so searches, campaign tags and test flags cannot leak in.
  window.createPropertyShare = function createPropertyShare(pin) {
    if (typeof pin !== "string" || !/^\d{11}$/.test(pin)) return null;
    const url = new URL("https://illinoislandindex.com/parcel-dashboard/");
    url.searchParams.set("scoreDetail", pin);
    url.hash = "property-result";
    const shareData = {
      title: "Property details | Illinois Land Index",
      text: "Explore this property's lot, land research score and utility information.",
      url: url.href,
    };
    const wrap = document.createElement("div");
    wrap.className = "property-share";
    const actions = document.createElement("div");
    actions.className = "property-share-actions";
    const share = document.createElement("button");
    share.type = "button";
    share.className = "property-share-button";
    share.textContent = "Share this property";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "property-copy-button";
    copy.textContent = "Copy link";
    // On browsers without native sharing the primary button copies the link.
    copy.hidden = typeof navigator.share !== "function";
    const status = document.createElement("p");
    status.className = "property-share-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    const manual = document.createElement("label");
    manual.className = "property-share-manual";
    manual.hidden = true;
    manual.append("Property link");
    const field = document.createElement("input");
    field.type = "text";
    field.readOnly = true;
    field.value = url.href;
    field.autocomplete = "off";
    field.spellcheck = false;
    field.addEventListener("click", () => field.select());
    manual.append(field);
    actions.append(share, copy);
    wrap.append(actions, status, manual);

    let busy = false;
    async function copyLink() {
      try {
        if (typeof navigator.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(url.href);
        if (wrap.isConnected) status.textContent = "Link copied. Paste it into a text or email.";
      } catch {
        if (!wrap.isConnected) return;
        manual.hidden = false;
        status.textContent = "Select and copy the property link below.";
        field.focus();
        field.select();
      }
    }
    async function run(nativeShare) {
      if (busy || !wrap.isConnected) return;
      busy = share.disabled = copy.disabled = true;
      status.textContent = "";
      manual.hidden = true;
      try {
        if (nativeShare && typeof navigator.share === "function") {
          try {
            await navigator.share(shareData);
            if (wrap.isConnected) status.textContent = "Property link shared.";
          } catch (error) {
            if (!wrap.isConnected) return;
            if (error?.name === "AbortError") status.textContent = "Sharing canceled.";
            else await copyLink();
          }
        } else await copyLink();
      } finally {
        busy = false;
        share.disabled = copy.disabled = false;
      }
    }
    share.addEventListener("click", () => run(true));
    copy.addEventListener("click", () => run(false));
    return wrap;
  };
})();
