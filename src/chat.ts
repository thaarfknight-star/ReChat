// Chat overlay (M2: live Kick messages over SSE from the Rust server.
// ?demo=1 keeps the old sample messages for styling without a live channel.)

type Badge = { kind: string; text: string; image?: string };
type Msg = {
  id: string;
  username: string;
  color?: string;
  badges: Badge[];
  content: string;
  created_at: string;
};

const params = new URLSearchParams(location.search);
const demo = params.get("demo") === "1";
const profile = params.get("profile");
if (profile) document.body.dataset.profile = profile;

const box = document.getElementById("messages") as HTMLDivElement;
const pinnedBox = document.getElementById("pinned") as HTMLDivElement;
const statusEl = document.getElementById("chatStatus") as HTMLDivElement;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mixed Persian/English text (M9): a Latin run inside an RTL message must
// keep its own punctuation (e.g. the "!" at the end of "great stream!").
// So Latin runs are wrapped in <bdi dir="ltr">, segment by segment, on the
// raw text (escaping each segment separately so entities never split).
const LATIN_RUN = /[(["'«“]*[A-Za-z0-9](?:[A-Za-z0-9\s.,!?'":;()\-_@#%&*+=/\\]*[A-Za-z0-9!?.])?/g;
function segmentLatin(raw: string): string {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(LATIN_RUN)) {
    const idx = m.index ?? 0;
    out += esc(raw.slice(last, idx));
    out += `<bdi dir="ltr">${esc(m[0])}</bdi>`;
    last = idx + m[0].length;
  }
  out += esc(raw.slice(last));
  return out;
}

// Kick emote syntax: [emote:ID:NAME] -> artwork image (alt = name,
// so a missing image still reads as the emote name). Emote tokens are
// split out BEFORE segmentation so a <bdi> never lands inside one.
function renderContent(content: string): string {
  return content
    .split(/(\[emote:\d+:[^\]]+\])/g)
    .map((part) => {
      const em = part.match(/^\[emote:(\d+):([^\]]+)\]$/);
      if (em) {
        return `<img class="emote" src="https://files.kick.com/emotes/${em[1]}/fullsize" alt="${esc(em[2])}" title="${esc(em[2])}" />`;
      }
      return segmentLatin(part);
    })
    .join("");
}

// Overlay language comes from the ?lang= param the settings window
// appends to the overlay link (M8 bilingual overlays). Chat direction
// (M9) rides the same link: ?dir=rtl|ltr|auto (auto = per-message).
const overlayLang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "fa";
document.documentElement.lang = overlayLang;
const chatDirParam = new URLSearchParams(location.search).get("dir");
const forcedDir = chatDirParam === "rtl" ? "rtl" : chatDirParam === "ltr" ? "ltr" : null;
document.documentElement.dir = forcedDir ?? (overlayLang === "fa" ? "rtl" : "ltr");

// 0.3.14: per-link column width override (?maxw=<px>, 0 = full width).
// An inline style on <html> beats the :root rule from the profile.
const maxwParam = new URLSearchParams(location.search).get("maxw");
if (maxwParam !== null) {
  const n = Number(maxwParam);
  document.documentElement.style.setProperty(
    "--chat-max-width",
    Number.isFinite(n) && n > 0 ? `${Math.round(n)}px` : "none",
  );
}

const badgeLabel: Record<string, string> = overlayLang === "fa"
  ? {
      broadcaster: "پخش‌کننده",
      moderator: "مدیر",
      vip: "VIP",
      subscriber: "ساب",
      founder: "بنیان‌گذار",
      og: "OG",
      staff: "کارمند",
      verified: "تأییدشده",
      sub_gifter: "هدیه‌دهنده",
    }
  : {
      broadcaster: "Broadcaster",
      moderator: "Mod",
      vip: "VIP",
      subscriber: "Sub",
      founder: "Founder",
      og: "OG",
      staff: "Staff",
      verified: "Verified",
      sub_gifter: "Gifter",
    };

function badgeHtml(b: Badge): string {
  if (b.image) {
    return `<img class="badge-img" src="${esc(b.image)}" alt="${esc(b.text || b.kind)}" title="${esc(b.text || b.kind)}" />`;
  }
  const cls = b.kind.replace(/[^a-z0-9_-]/gi, "");
  return `<span class="badge ${cls}">${esc(badgeLabel[b.kind] ?? b.text ?? b.kind)}</span>`;
}

function msgEl(m: Msg): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "msg";
  // Auto: first strong char decides (Persian RTL, English LTR). A forced
  // direction from ?dir= pins every message to that direction instead.
  el.dir = forcedDir ?? "auto";
  el.dataset.id = m.id;
  el.innerHTML = `${(m.badges ?? []).map(badgeHtml).join("")}<bdi><span class="user" style="color:${esc(m.color || "#ffffff")}">${esc(m.username)}</span></bdi>: ${renderContent(m.content)}`;
  return el;
}

// Max messages: injected by the server per profile
// (window.RECHAT_MAX_MESSAGES), 50 when absent (plain file/dev).
const MAX =
  (window as unknown as { RECHAT_MAX_MESSAGES?: number }).RECHAT_MAX_MESSAGES ?? 50;

let started = false;
function show(m: Msg): void {
  if (!started) {
    started = true;
    box.innerHTML = "";
  }
  box.appendChild(msgEl(m));
  while (box.children.length > MAX) box.firstChild?.remove();
}

function removeById(id: string, from: HTMLDivElement): void {
  from.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
}

function pin(m: Msg): void {
  removeById(m.id, pinnedBox);
  pinnedBox.appendChild(msgEl(m));
  // Pinned box is unbounded by nature; cap it so it never grows the DOM.
  while (pinnedBox.children.length > 5) pinnedBox.firstChild?.remove();
}

const statusText: Record<string, string> = overlayLang === "fa"
  ? {
      idle: "وصل نیست",
      resolving: "در حال پیدا کردن کانال…",
      connecting: "در حال اتصال…",
      connected: "متصل",
      reconnecting: "اتصال دوباره…",
      error: "خطا در اتصال",
    }
  : {
      idle: "Not connected",
      resolving: "Resolving channel…",
      connecting: "Connecting…",
      connected: "Connected",
      reconnecting: "Reconnecting…",
      error: "Connection error",
    };

if (demo) {
  const samples: Array<{ user: string; color: string; badge?: string; text: string }> = [
    { user: "tahaa", color: "#4ade80", badge: overlayLang === "fa" ? "مدیر" : "Mod", text: overlayLang === "fa" ? "سلام به همه! بازی امشب سولزلایک است" : "Hey everyone! Tonight we play a soulslike" },
    { user: "soul_fan", color: "#58a6ff", text: "this boss fight is insane 🔥" },
    { user: "nightowl", color: "#f472b6", badge: "VIP", text: overlayLang === "fa" ? "چت فارسی و انگلیسی قاطی هم خوب درمیاد، great stream!" : "Persian and English chat mix nicely, great stream!" },
    { user: "long_reader", color: "#a78bfa", text: overlayLang === "fa" ? "این یک پیام طولانی است برای اینکه ببینیم متن بلند چندخطی چطور می‌شکند و فاصله‌ی خطوط و داخل پیام چقدر خواناست، مخصوصاً وقتی وسطش یک عبارت انگلیسی مثل boss fight هم باشد و آخرش علامت تعجب! " : "This is a long message to check how multi-line text wraps, how line height and padding read, especially with a Persian phrase in the middle like سلام به همه and an exclamation mark at the end!" },
    { user: "emote_king", color: "#fbbf24", text: overlayLang === "fa" ? "این ایموت‌ها چطور دیده می‌شوند؟ [emote:123:KEKW] [emote:456:Pog]" : "How do these emotes look? [emote:123:KEKW] [emote:456:Pog]" },
  ];
  box.innerHTML = "";
  for (const s of samples) {
    box.appendChild(
      msgEl({
        id: `demo-${s.user}`,
        username: s.user,
        color: s.color,
        badges: s.badge ? [{ kind: "demo", text: s.badge }] : [],
        content: s.text,
        created_at: "",
      }),
    );
  }
  statusEl.textContent = overlayLang === "fa" ? "حالت نمایشی (demo)" : "Demo mode";
} else {
  box.innerHTML = `<div class="msg" dir="rtl">${overlayLang === "fa" ? "در انتظار پیام زنده…" : "Waiting for live messages…"}</div>`;
  const es = new EventSource("/api/chat/stream");
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as { type: string } & Partial<Msg> & {
        state?: string;
        channel?: string;
        detail?: string;
      };
      if (ev.type === "message" && ev.username) {
        show(ev as unknown as Msg);
      } else if (ev.type === "deleted" && ev.id) {
        removeById(ev.id, box);
        removeById(ev.id, pinnedBox);
      } else if (ev.type === "pinned" && ev.username) {
        pin(ev as unknown as Msg);
      } else if (ev.type === "unpinned" && ev.id) {
        removeById(ev.id, pinnedBox);
      } else if (ev.type === "status" && ev.state) {
        statusEl.textContent =
          (statusText[ev.state] ?? ev.state) +
          (ev.channel ? ` (${ev.channel})` : "") +
          (ev.detail ? ` — ${ev.detail}` : "");
      }
    } catch {
      // A malformed line must never kill the overlay.
    }
  };
  es.onerror = () => {
    statusEl.textContent =
      overlayLang === "fa" ? "ارتباط با سرور محلی قطع شد، تلاش دوباره…" : "Local server connection lost, retrying…";
  };
}

export {};
