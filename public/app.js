"use strict";

const byId = (id) => document.getElementById(id);
const drawCard = byId("draw-card");
const participantList = byId("participant-list");
const participantTemplate = byId("participant-template");
const addParticipant = byId("add-participant");
const inviteField = byId("invite-link");
const guestName = byId("guest-name");
const viewNames = ["setup", "share", "guest", "result", "closed", "missing"];
const examples = ["e.g. Holly", "e.g. Noel", "e.g. Robin"];
const minimumParticipants = 3;
let nextParticipantId = 0;
let pageRevision = 0;

function showView(name, focus = true) {
  for (const view of viewNames) {
    byId(`${view}-view`).hidden = view !== name;
  }
  const heading = byId(`${name}-title`);
  drawCard.setAttribute("aria-labelledby", heading.id);
  if (focus) heading.focus();
}

function setMessage(id, message = "") {
  const output = byId(id);
  output.textContent = message;
  output.hidden = !message;
}

function cleanName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

async function request(path, payload) {
  const options = { cache: "no-store", redirect: "error" };
  if (payload) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    const error = new Error(body?.error || "");
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}

function describeError(error, fallback) {
  return error.status >= 400 && error.status < 500 && error.message ? error.message : fallback;
}

function setBusy(button, busy, pendingText, idleText) {
  button.disabled = busy;
  button.lastElementChild.textContent = busy ? pendingText : idleText;
}

function labelRow(row, index) {
  const position = index + 1;
  row.querySelector("label").textContent = `Name for Santa ${position}`;
  row.querySelector("input").placeholder = examples[index] || "First name or nickname";
  row.querySelector("button").setAttribute("aria-label", `Remove Santa ${position}`);
}

function clearSetupError() {
  setMessage("setup-error");
  for (const input of participantList.querySelectorAll("[aria-invalid]")) {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-errormessage");
  }
}

function addSanta(focus = true) {
  const row = participantTemplate.content.firstElementChild.cloneNode(true);
  const input = row.querySelector("input");
  input.id = `santa-${++nextParticipantId}`;
  row.querySelector("label").htmlFor = input.id;
  row.querySelector("button").addEventListener("click", () => {
    const nextRow = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    Array.from(participantList.children).forEach(labelRow);
    clearSetupError();
    (nextRow?.querySelector("input") || addParticipant).focus();
  });
  labelRow(row, participantList.children.length);
  participantList.append(row);
  if (focus) {
    clearSetupError();
    input.focus();
  }
}

function resetSetup() {
  clearSetupError();
  participantList.replaceChildren();
  for (let index = 0; index < minimumParticipants; index++) addSanta(false);
}

function showSetupError(message, inputs = []) {
  setMessage("setup-error", message);
  for (const input of inputs) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", "setup-error");
  }
  if (inputs.length) inputs[0].focus();
}

function showShare({ id, count }) {
  inviteField.value = new URL(`/draw/${encodeURIComponent(id)}`, location.origin).href;
  byId("share-summary").textContent = `Your ${count} Santas each have a match. Send the link so everyone can open theirs.`;
  byId("share-link").hidden = typeof navigator.share !== "function";
  setMessage("copy-status");
  showView("share");
}

async function createDraw(event) {
  event.preventDefault();
  const button = byId("create-draw");
  if (button.disabled) return;

  clearSetupError();
  const inputs = Array.from(participantList.querySelectorAll("input"));
  if (inputs.length < minimumParticipants) {
    showSetupError(`Add at least ${minimumParticipants} Santas to draw names.`);
    addParticipant.focus();
    return;
  }

  const names = inputs.map((input) => cleanName(input.value));
  const emptyIndex = names.findIndex((name) => !name);
  if (emptyIndex !== -1) {
    showSetupError("Enter a name or remove the empty field.", [inputs[emptyIndex]]);
    return;
  }

  const firstIndexByName = new Map();
  for (const [index, name] of names.entries()) {
    const key = name.toLowerCase();
    if (firstIndexByName.has(key)) {
      showSetupError("Each Santa needs a unique name. Try a nickname or add an initial.", [inputs[index], inputs[firstIndexByName.get(key)]]);
      return;
    }
    firstIndexByName.set(key, index);
  }

  setBusy(button, true, "Drawing names…", "Draw names");
  participantList.inert = true;
  addParticipant.disabled = true;
  try {
    showShare(await request("/api/draws", { names }));
  } catch (error) {
    showSetupError(describeError(error, "We couldn’t create the draw. Please try again."));
  } finally {
    participantList.inert = false;
    addParticipant.disabled = false;
    setBusy(button, false, "Drawing names…", "Draw names");
  }
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteField.value);
    setMessage("copy-status", "Link copied.");
  } catch {
    inviteField.focus();
    inviteField.select();
    setMessage("copy-status", "The link is selected and ready to copy.");
  }
}

async function shareInvite() {
  try {
    await navigator.share({ title: "Secret Santa invitation", url: inviteField.value });
  } catch (error) {
    if (error.name !== "AbortError") setMessage("copy-status", "Use Copy link to share this invitation.");
  }
}

function initOrganiser() {
  resetSetup();
  addParticipant.addEventListener("click", () => addSanta());
  participantList.addEventListener("input", clearSetupError);
  byId("setup-form").addEventListener("submit", createDraw);
  byId("copy-link").addEventListener("click", copyInvite);
  byId("share-link").addEventListener("click", shareInvite);
  inviteField.addEventListener("click", () => inviteField.select());
  byId("new-draw").addEventListener("click", () => {
    inviteField.value = "";
    resetSetup();
    showView("setup");
  });
}

function showMissing(message, canRetry, focus = true) {
  byId("missing-description").textContent = message;
  byId("retry-draw").hidden = !canRetry;
  showView("missing", focus);
}

function showGuestError(message, invalidName = false) {
  setMessage("guest-error", message);
  if (invalidName) {
    guestName.setAttribute("aria-invalid", "true");
    guestName.setAttribute("aria-errormessage", "guest-error");
    guestName.focus();
  } else {
    guestName.removeAttribute("aria-invalid");
    guestName.removeAttribute("aria-errormessage");
  }
}

function closeReveal(focus = true) {
  byId("recipient-name").textContent = "";
  showView("closed", focus);
}

async function revealMatch(event, drawPath) {
  event.preventDefault();
  const button = byId("reveal-draw");
  if (button.disabled) return;
  showGuestError("");
  const name = cleanName(guestName.value);
  if (!name) {
    showGuestError("Enter the name your organiser used for you.", true);
    return;
  }

  const currentRevision = pageRevision;
  setBusy(button, true, "Opening your match…", "Reveal my match");
  guestName.readOnly = true;
  try {
    const { recipient } = await request(`${drawPath}/reveal`, { name });
    if (pageRevision === currentRevision) {
      guestName.value = "";
      byId("recipient-name").textContent = recipient;
      showView("result");
    }
  } catch (error) {
    if (pageRevision !== currentRevision) return;
    if (error.code === "draw_not_found") {
      showMissing("Ask your organiser for the link to your draw.", false);
    } else if (error.code === "name_not_found") {
      showGuestError("We couldn’t find that name. Check the spelling your organiser used.", true);
    } else if (error.code === "already_revealed") {
      showGuestError("This match has already been opened.");
    } else {
      showGuestError(describeError(error, "We couldn’t open your match. Please try again."));
    }
  } finally {
    guestName.readOnly = false;
    setBusy(button, false, "Opening your match…", "Reveal my match");
  }
}

function initGuest(id) {
  const drawPath = `/api/draws/${id}`;
  document.body.classList.add("guest-route");
  document.title = "Your Secret Santa invitation";
  const heroAccent = document.createElement("em");
  heroAccent.textContent = "your match.";
  byId("hero-title").replaceChildren("Unwrap", document.createElement("br"), heroAccent);
  byId("hero-description").textContent = "Your gift exchange is ready. Find out who you’re shopping for this Christmas.";
  byId("how-it-works").hidden = true;
  const homeLink = byId("masthead-link");
  homeLink.href = "/";
  homeLink.textContent = "Start your own draw";

  async function loadDraw(focus = false) {
    byId("guest-form").hidden = true;
    byId("guest-loading").hidden = false;
    showView("guest", focus);
    try {
      await request(drawPath);
      byId("guest-form").hidden = false;
    } catch (error) {
      if (error.status === 404) {
        showMissing("Ask your organiser for the link to your draw.", false, focus);
      } else {
        showMissing("The invitation could not be loaded. Please try again.", true, focus);
      }
    } finally {
      byId("guest-loading").hidden = true;
    }
  }

  byId("retry-draw").addEventListener("click", () => loadDraw(true));
  byId("guest-form").addEventListener("submit", (event) => revealMatch(event, drawPath));
  guestName.addEventListener("input", () => showGuestError(""));
  byId("close-reveal").addEventListener("click", () => closeReveal());
  window.addEventListener("pagehide", () => {
    pageRevision++;
    if (!byId("result-view").hidden) closeReveal(false);
  });
  loadDraw();
}

const guestRoute = /^\/draw\/([^/]+)\/?$/.exec(location.pathname);
if (guestRoute) initGuest(guestRoute[1]);
else initOrganiser();
