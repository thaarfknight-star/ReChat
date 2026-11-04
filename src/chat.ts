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

// Kick emote syntax: [emote:ID:NAME] -> artwork image (alt = name,
// so a missing image still reads as the emote name).
function renderContent(content: string): string {
  return esc(content).replace(
    /\[emote:(\d+):([^\]]+)\]/g,
    (_m, id, name) =>
      `<img class="emote" src="https://files.kick.com/emotes/${id}/fullsize" alt="${esc(name)}" title="${esc(name)}" />`,
  );
}

const badgeLabel: Record<string, string> = {
  broadcaster: "پخش‌کننده",
  moderator: "مدیر",
  vip: "VIP",
  subscriber: "ساب",
  founder: "بنیان‌گذار",
  og: "OG",
  staff: "کارمند",
  verified: "تأییدشده",
  sub_gifter: "هدیه‌دهنده",
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
  el.dir = "auto"; // first strong char decides: Persian RTL, English LTR
  el.dataset.id = m.id;
  el.innerHTML = `${(m.badges ?? []).map(badgeHtml).join("")}<span class="user" style="color:${esc(m.color || "#ffffff")}">${esc(m.username)}</span>: ${renderContent(m.content)}`;
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

const statusText: Record<string, string> = {
  idle: "وصل نیست",
  resolving: "در حال پیدا کردن کانال…",
  connecting: "در حال اتصال…",
  connected: "متصل",
  reconnecting: "اتصال دوباره…",
  error: "خطا در اتصال",
};

if (demo) {
  const samples: Array<{ user: string; color: string; badge?: string; text: string }> = [
    { user: "tahaa", color: "#4ade80", badge: "مدیر", text: "سلام به همه! بازی امشب سولزلایک است" },
    { user: "soul_fan", color: "#58a6ff", text: "this boss fight is insane 🔥" },
    { user: "nightowl", color: "#f472b6", badge: "VIP", text: "چت فارسی و انگلیسی قاطی هم خوب درمیاد، great stream!" },
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
  statusEl.textContent = "حالت نمایشی (demo)";
} else {
  box.innerHTML = `<div class="msg" dir="rtl">در انتظار پیام زنده…</div>`;
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
    statusEl.textContent = "ارتباط با سرور محلی قطع شد، تلاش دوباره…";
  };
}

export {};
