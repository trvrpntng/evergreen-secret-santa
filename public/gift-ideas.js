"use strict";

function httpsLink(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function showAffiliateLinks() {
  try {
    const response = await fetch("/api/gift-ideas", { cache: "no-store", redirect: "error" });
    if (!response.ok) return;
    const { links } = await response.json();
    if (!links || typeof links !== "object") return;

    const disclosure = document.getElementById("affiliate-disclosure");
    for (const anchor of document.querySelectorAll("[data-gift-link]")) {
      const href = httpsLink(links[anchor.dataset.giftLink]);
      if (!href) continue;
      disclosure.hidden = false;
      anchor.href = href;
      anchor.hidden = false;
    }
  } catch {
    // The gift suggestions remain available when shop links cannot be loaded.
  }
}

showAffiliateLinks();
