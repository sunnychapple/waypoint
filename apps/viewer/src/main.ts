// The shared-link viewer (V1). It reads the link key from the URL fragment, which browsers never send, unlocks the
// item with WebCrypto, and shows it as text. It loads no other script, except Cloudflare Turnstile for a passcode link.
import { checkSharedItem, type SharedItem } from "./item.ts";
import { context, importLinkKey, keyFromFragment, linkIdFromPath, unlock } from "./unlock.ts";

declare const TURNSTILE_SITE_KEY: string; // set by build.mjs from the environment

type Turnstile = {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  reset(widget: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function show(...nodes: HTMLElement[]): void {
  document.getElementById("app")?.replaceChildren(...nodes);
}

function message(title: string, body: string, retry?: () => void): void {
  const nodes: HTMLElement[] = [el("h1", title), el("p", body)];
  if (retry !== undefined) {
    const button = el("button", "Try again");
    button.type = "button";
    button.addEventListener("click", () => retry());
    nodes.push(button);
  }
  show(...nodes);
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render(item: SharedItem): void {
  const nodes: HTMLElement[] = [el("h1", item.title), el("p", new Date(item.created_at).toLocaleDateString(), "muted")];
  if (item.transcript.length > 0) {
    nodes.push(el("h2", "Transcript"));
    for (const line of item.transcript) {
      const p = el("p");
      p.append(el("span", clock(line.t), "time"), document.createTextNode(` ${line.text}`));
      nodes.push(p);
    }
  }
  if (item.pages.length > 0) {
    nodes.push(el("h2", "Pages"));
    item.pages.forEach((page, i) => nodes.push(el("h3", `Page ${i + 1}`), el("p", page.text, "page")));
  }
  nodes.push(el("p", "Shared from NotePath. Only people with this link can open it.", "muted"));
  show(...nodes);
}

let turnstileLoading: Promise<Turnstile> | null = null;

// Loaded only for a passcode link, after the key is imported and gone from the address bar (docs/security.md R10).
function loadTurnstile(): Promise<Turnstile> {
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_URL;
    script.async = true;
    // A failed load is forgotten, so Try again fetches the script again.
    const fail = (): void => {
      script.remove();
      turnstileLoading = null;
      reject(new Error("turnstile"));
    };
    script.onload = () => (window.turnstile === undefined ? fail() : resolve(window.turnstile));
    script.onerror = fail;
    document.head.append(script);
  });
  return turnstileLoading;
}

async function askPasscode(id: string, key: CryptoKey, note: string | null): Promise<void> {
  const form = el("form");
  const input = el("input");
  input.type = "password";
  input.autocomplete = "off";
  input.maxLength = 64;
  input.placeholder = "Passcode";
  const check = el("div");
  const button = el("button", "Open");
  button.type = "submit";
  form.append(input, check, button);
  show(el("h1", "This link has a passcode"), el("p", "Ask the person who shared it."), ...(note === null ? [] : [el("p", note, "error")]), form);
  let token = "";
  let widget = "";
  try {
    const turnstile = await loadTurnstile();
    widget = turnstile.render(check, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (t) => (token = t),
      "expired-callback": () => (token = ""),
      "error-callback": () => (token = ""),
    });
  } catch {
    message("Couldn't load the check", "Check your connection, then try again.", () => void askPasscode(id, key, note));
    return;
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (input.value === "" || token === "") return;
    const headers = { "Waypoint-Link-Passcode": input.value, "Waypoint-Turnstile": token };
    token = "";
    window.turnstile?.reset(widget); // a token works once
    void load(id, key, headers);
  };
}

async function load(id: string, key: CryptoKey, headers: Record<string, string>): Promise<void> {
  // A Turnstile token works only once, so a passcode retry asks for a new one instead of resending these headers.
  const retry = (): void => {
    if (Object.keys(headers).length === 0) void load(id, key, {});
    else void askPasscode(id, key, null);
  };
  let reply: Response;
  try {
    reply = await fetch(`/v1/links/${id}/data`, { headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    message("You're offline", "Connect to the internet, then try again.", retry);
    return;
  }
  if (reply.status === 401) {
    const body: unknown = await reply.json().catch(() => null);
    const wrong = typeof body === "object" && body !== null && "message" in body && body.message === "wrong passcode";
    await askPasscode(id, key, wrong ? "That passcode isn't right." : null);
    return;
  }
  if (reply.status === 403) return askPasscode(id, key, "The check didn't work. Try again.");
  if (reply.status === 404) return message("This link doesn't work anymore", "It was turned off, or it expired.");
  if (reply.status === 429) return message("Too many tries", "Wait a minute, then try again.", retry);
  if (!reply.ok) return message("Something went wrong", "Try again later.", retry);
  let bytes: ArrayBuffer;
  try {
    bytes = await reply.arrayBuffer();
  } catch {
    message("You're offline", "Connect to the internet, then try again.", retry);
    return;
  }
  const plain = await unlock(key, context("link", id), new Uint8Array(bytes));
  let item: SharedItem | null = null;
  try {
    item = plain === null ? null : checkSharedItem(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)));
  } catch {
    item = null;
  }
  if (item === null) return message("This link can't be opened", "Part of the link is missing or changed. Ask for the link again.");
  render(item);
}

async function run(): Promise<void> {
  const id = linkIdFromPath(location.pathname);
  const raw = keyFromFragment(location.hash);
  if (id === null || raw === null) return message("This link is incomplete", "Ask for the whole link again. It ends with #k= and a long code.");
  const key = await importLinkKey(raw);
  raw.fill(0);
  // The key leaves the address bar (and history) before anything else loads.
  history.replaceState(null, "", location.pathname);
  await load(id, key, {});
}

void run();
