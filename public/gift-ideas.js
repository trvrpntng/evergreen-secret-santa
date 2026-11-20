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
    for (const group of document.querySelectorAll("[data-gift-category]")) {
      const category = links[group.dataset.giftCategory];
      const entries = typeof category === "string"
        ? [[group.dataset.defaultLabel, category]]
        : Object.entries(category ?? {});

      for (const [label, url] of entries) {
        const href = httpsLink(url);
        if (!href) continue;
        const anchor = document.createElement("a");
        anchor.className = "add-button";
        anchor.href = href;
        anchor.rel = "sponsored nofollow noopener noreferrer";
        anchor.textContent = label;
        group.append(anchor);
      }

      if (!group.childElementCount) continue;
      group.hidden = false;
      disclosure.hidden = false;
    }
  } catch {
    // The gift suggestions remain available when shop links cannot be loaded.
  }
}

showAffiliateLinks();
