// ReChat settings UI (M2: live chat connect + filters via Tauri commands.
// Outside Tauri (plain browser dev) the buttons degrade to local save.)

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";

type Lang = "fa" | "en";
type ChatState = "idle" | "resolving" | "connecting" | "connected" | "reconnecting" | "error";

const dict: Record<Lang, Record<string, string>> = {
  fa: {
    tagline: "چت و Goal کیک، برای Meld Studio",
    chatTitle: "چت کیک",
    channelLabel: "نام کانال یا لینک کانال",
    connect: "اتصال",
    disconnect: "قطع اتصال",
    chatOffline: "وصل نیست",
    chatNote: "پیام‌های زنده‌ی کانال در اورلی نمایش داده می‌شوند.",
    filtersTitle: "فیلترهای چت",
    hideCmdLabel: "دستورها را پنهان کن (پیام‌های شروع‌شونده با !)",
    usersLabel: "کاربران پنهان (هر خط یک نام)",
    botsLabel: "بات‌ها (هر خط یک نام)",
    wordsLabel: "کلمه‌های پنهان (هر خط یک کلمه)",
    filtersNote: "فیلترها همان لحظه روی پیام‌های تازه اعمال می‌شوند.",
    customTitle: "شخصی‌سازی و پروفایل‌ها",
    profileLabel: "پروفایل صحنه",
    profileNote: "هر پروفایل لینک اورلی خودش را دارد: /chat?profile=نام و /goal?profile=نام — همان لینک را در Meld بگذارید.",
    newProfile: "ساخت",
    renameProfile: "تغییر نام",
    dupProfile: "کپی",
    delProfile: "حذف",
    exportJson: "خروجی JSON",
    importJson: "ورودی JSON",
    copyChatProfile: "کپی لینک چت این پروفایل",
    copyGoalProfile: "کپی لینک Goal این پروفایل",
    cssSample: "CSS نمونه",
    cssDocs: "راهنمای کلاس‌ها",
    prevChat: "چت",
    prevGoal: "Goal",
    meldGuideTitle: "راهنمای Meld Studio",
    meldGuideIntro: "پس‌زمینه‌ی اورلی‌ها کاملاً شفاف است؛ نیازی به Chroma Key نیست. مصرف هم سبک است: چت فقط با رویداد زنده می‌آید و سقف پیام دارد، و Goal هر ۱۰ ثانیه یک‌بار خوانده می‌شود.",
    meldStep1: "ReChat را اجرا کن؛ در بخش چت نام کانال را بزن و «اتصال» را بزن تا وضعیت «متصل ✓» شود.",
    meldStep2: "لینک Goal را در بخش Goal بزن و «ذخیره» را بزن تا وضعیت Goal هم «متصل ✓» شود.",
    meldStep3: "در Meld، در پنل Layers روی + بزن و Browser را انتخاب کن — یا لینک را مستقیم روی بوم با Ctrl+V بچسبان تا لایه‌ی Browser خودش ساخته شود.",
    meldStep4: "لینک اورلی را از ReChat کپی کن (بخش لینک‌های اورلی، یا لینک همان پروفایل) و در قسمت URL پنل Inspector بچسبان.",
    meldStep5: "اندازه را روی بوم با کشیدن گوشه‌ها تنظیم کن، یا W و H را در Inspector بنویس (پیشنهاد: چت ۴۲۰×۷۰۰، Goal ۹۰۰×۱۸۰). برای ثابت ماندن اندازه‌ی صفحه هنگام تغییر لایه، Lock Size را فعال کن.",
    meldStep6: "اگر پیام تازه نیامد، روی آیکن تازه‌سازی (reload) کنار فیلد URL بزن.",
    meldStep7: "برای هر صحنه، پروفایل همان صحنه را در ReChat انتخاب کن و لینک همان پروفایل را در Meld بگذار.",
    meldStep8: "ReChat باید در تمام مدت استریم باز بماند؛ لینک‌ها فقط روی همین سیستم (localhost) کار می‌کنند و بدون ReChat چیزی نشان نمی‌دهند.",
    meldTrouble: "اگر صفحه سیاه دیدی: اول مطمئن شو لایه‌ی دیگری روی آن نیست، بعد reload را بزن. اورلی‌های ReChat صدا ندارند، پس نیازی به «Add an audio track» نیست.",
    goalTitle: "Goal",
    goalLabel: "لینک Goal",
    save: "ذخیره",
    goalUnset: "تنظیم نشده",
    goalNote: "Goal زنده از لینک Donofa خوانده می‌شود؛ هر ۱۰ ثانیه تازه می‌شود.",
    goalLoading: "در حال خواندن…",
    goalLive: "متصل ✓",
    goalError: "خطا در Goal",
    overlayTitle: "لینک‌های اورلی (سرور محلی)",
    copyLink: "کپی لینک",
    overlayNote: "این لینک‌ها را در Meld به‌عنوان Browser Source اضافه کنید (راهنمای قدم‌به‌قدم در M5 داخل برنامه می‌آید).",
    aboutTitle: "درباره‌ی ReChat",
    aboutText: "نسخه‌ی ۰٫۱٫۰ (M5 — چت و Goal زنده + شخصی‌سازی + راهنمای Meld). چت و Goal کیک را می‌گیرد و به‌صورت اورلی شفاف به Meld می‌دهد. بدون لاگین؛ تنظیمات فقط روی همین سیستم می‌ماند.",
    aboutLicense: "لایسنس: دوگانه‌ی MIT/Apache-2.0 — © 2026 Taha Arefi. متن کامل لایسنس‌ها همراه نصب‌کننده است.",
    updateBtn: "بررسی به‌روزرسانی",
    updateChecking: "در حال بررسی…",
    updateLatest: "نسخه به‌روز است.",
    updateFailed: "بررسی ناموفق بود؛ بعداً دوباره بزن.",
    copied: "کپی شد!",
    saved: "ذخیره شد.",
    resolving: "در حال پیدا کردن کانال…",
    connecting: "در حال اتصال…",
    connected: "متصل ✓",
    reconnecting: "اتصال دوباره…",
    error: "خطا در اتصال",
  },
  en: {
    tagline: "Kick chat and Goal, for Meld Studio",
    chatTitle: "Kick chat",
    channelLabel: "Channel name or channel URL",
    connect: "Connect",
    disconnect: "Disconnect",
    chatOffline: "Not connected",
    chatNote: "Live channel messages show up in the overlay.",
    filtersTitle: "Chat filters",
    hideCmdLabel: "Hide commands (messages starting with !)",
    usersLabel: "Hidden users (one per line)",
    botsLabel: "Bots (one per line)",
    wordsLabel: "Hidden words (one per line)",
    filtersNote: "Filters apply instantly to new messages.",
    customTitle: "Customization and profiles",
    profileLabel: "Scene profile",
    profileNote: "Each profile has its own overlay links: /chat?profile=name and /goal?profile=name — put that link in Meld.",
    newProfile: "Create",
    renameProfile: "Rename",
    dupProfile: "Duplicate",
    delProfile: "Delete",
    exportJson: "Export JSON",
    importJson: "Import JSON",
    copyChatProfile: "Copy this profile's chat link",
    copyGoalProfile: "Copy this profile's goal link",
    cssSample: "Sample CSS",
    cssDocs: "Class guide",
    prevChat: "Chat",
    prevGoal: "Goal",
    meldGuideTitle: "Meld Studio guide",
    meldGuideIntro: "Overlay backgrounds are fully transparent; no Chroma Key needed. Footprint is light: chat arrives on live events only with a message cap, and the goal is read once every 10 seconds.",
    meldStep1: "Run ReChat; in the chat section enter the channel name and hit Connect until the status shows Connected ✓.",
    meldStep2: "Paste the Goal link in the Goal section and hit Save until the goal status shows Connected ✓.",
    meldStep3: "In Meld, click + in the Layers panel and choose Browser — or paste the link straight onto the canvas with Ctrl+V to create a Browser layer automatically.",
    meldStep4: "Copy the overlay link from ReChat (the overlay links section, or that profile's link) and paste it into the URL field in the Inspector panel.",
    meldStep5: "Resize by dragging the corners on the canvas, or set W and H in the Inspector (suggested: chat 420×700, goal 900×180). Turn on Lock Size to keep the page size fixed while resizing the layer.",
    meldStep6: "If new messages don't appear, hit the reload icon next to the URL field.",
    meldStep7: "For each scene, pick that scene's profile in ReChat and use that profile's link in Meld.",
    meldStep8: "ReChat must stay open for the whole stream; the links are localhost-only and show nothing without it.",
    meldTrouble: "If you see a black page: first make sure no other layer covers it, then hit reload. ReChat overlays have no sound, so no “Add an audio track” is needed.",
    goalTitle: "Goal",
    goalLabel: "Goal link",
    save: "Save",
    goalUnset: "Not set",
    goalNote: "Live goal is read from the Donofa link; refreshed every 10 seconds.",
    goalLoading: "Reading…",
    goalLive: "Connected ✓",
    goalError: "Goal error",
    overlayTitle: "Overlay links (local server)",
    copyLink: "Copy link",
    overlayNote: "Add these links in Meld as a Browser Source (a step-by-step guide arrives in-app in M5).",
    aboutTitle: "About ReChat",
    aboutText: "Version 0.1.0 (M5 — live chat and goal + customization + Meld guide). Takes Kick chat and Goal and hands them to Meld as transparent overlays. No login; settings stay on this machine.",
    aboutLicense: "License: dual MIT/Apache-2.0 — © 2026 Taha Arefi. Full license texts ship with the installer.",
    updateBtn: "Check for updates",
    updateChecking: "Checking…",
    updateLatest: "You are up to date.",
    updateFailed: "Check failed; try again later.",
    copied: "Copied!",
    saved: "Saved.",
    resolving: "Resolving channel…",
    connecting: "Connecting…",
    connected: "Connected ✓",
    reconnecting: "Reconnecting…",
    error: "Connection error",
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PORT = 17874;
const base = `http://localhost:${PORT}`;
const isTauri =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;

const channelInput = $<HTMLInputElement>("channelInput");
const goalInput = $<HTMLInputElement>("goalInput");
const langBtn = $<HTMLButtonElement>("langBtn");
const chatStatus = $("chatStatus");
const goalStatus = $("goalStatus");
const hideCmdChk = $<HTMLInputElement>("hideCmdChk");
const usersTa = $<HTMLTextAreaElement>("usersTa");
const botsTa = $<HTMLTextAreaElement>("botsTa");
const wordsTa = $<HTMLTextAreaElement>("wordsTa");

let lang: Lang = (localStorage.getItem("rechat-lang") as Lang) || "fa";
channelInput.value = localStorage.getItem("rechat-channel") ?? "";
goalInput.value = localStorage.getItem("rechat-goal") ?? "";

type Filters = {
  hide_commands: boolean;
  hidden_users: string[];
  hidden_words: string[];
  hidden_bots: string[];
};

function lines(ta: HTMLTextAreaElement): string[] {
  return ta.value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function currentFilters(): Filters {
  return {
    hide_commands: hideCmdChk.checked,
    hidden_users: lines(usersTa),
    hidden_words: lines(wordsTa),
    hidden_bots: lines(botsTa),
  };
}

function applyFiltersToUi(f: Filters): void {
  hideCmdChk.checked = f.hide_commands;
  usersTa.value = f.hidden_users.join("\n");
  wordsTa.value = f.hidden_words.join("\n");
  botsTa.value = f.hidden_bots.join("\n");
}

try {
  const saved = localStorage.getItem("rechat-filters");
  if (saved) applyFiltersToUi(JSON.parse(saved) as Filters);
} catch {
  // Corrupt mirror: start empty, backend state wins on load.
}

function statusText(state: string, channel?: string, detail?: string): string {
  const t = dict[lang];
  let s: string;
  switch (state as ChatState) {
    case "connected":
      s = t.connected;
      break;
    case "resolving":
      s = t.resolving;
      break;
    case "connecting":
      s = t.connecting;
      break;
    case "reconnecting":
      s = t.reconnecting;
      break;
    case "error":
      s = t.error;
      break;
    default:
      s = t.chatOffline;
  }
  if (channel) s += ` (${channel})`;
  if (detail) s += ` — ${detail}`;
  return s;
}

function renderStatus(state: string, channel?: string, detail?: string): void {
  chatStatus.textContent = statusText(state, channel, detail);
  chatStatus.style.background =
    state === "connected" ? "#16a34a" : state === "error" ? "#dc2626" : "";
}

function applyLang(): void {
  const t = dict[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  ($("tagline").textContent = t.tagline);
  ($("chatTitle").textContent = t.chatTitle);
  ($("channelLabel").textContent = t.channelLabel);
  ($("connectBtn").textContent = t.connect);
  ($("disconnectBtn").textContent = t.disconnect);
  ($("chatNote").textContent = t.chatNote);
  ($("filtersTitle").textContent = t.filtersTitle);
  ($("hideCmdLabel").textContent = t.hideCmdLabel);
  ($("usersLabel").textContent = t.usersLabel);
  ($("botsLabel").textContent = t.botsLabel);
  ($("wordsLabel").textContent = t.wordsLabel);
  ($("filtersNote").textContent = t.filtersNote);
  ($("customTitle").textContent = t.customTitle);
  ($("profileLabel").textContent = t.profileLabel);
  ($("profileNote").textContent = t.profileNote);
  ($("newProfileBtn").textContent = t.newProfile);
  ($("renameProfileBtn").textContent = t.renameProfile);
  ($("dupProfileBtn").textContent = t.dupProfile);
  ($("delProfileBtn").textContent = t.delProfile);
  ($("exportBtn").textContent = t.exportJson);
  ($("importBtn").textContent = t.importJson);
  ($("copyChatProfileBtn").textContent = t.copyChatProfile);
  ($("copyGoalProfileBtn").textContent = t.copyGoalProfile);
  ($("cssSampleBtn").textContent = t.cssSample);
  ($("cssDocsBtn").textContent = t.cssDocs);
  ($("prevChatBtn").textContent = t.prevChat);
  ($("prevGoalBtn").textContent = t.prevGoal);
  ($("meldGuideTitle").textContent = t.meldGuideTitle);
  ($("meldGuideIntro").textContent = t.meldGuideIntro);
  for (let i = 1; i <= 8; i++) {
    const li = document.querySelector(`#meldGuide li[data-step="${i}"]`);
    if (li) li.textContent = (t as Record<string, string>)[`meldStep${i}`];
  }
  ($("meldTrouble").textContent = t.meldTrouble);
  ($("goalTitle").textContent = t.goalTitle);
  ($("goalLabel").textContent = t.goalLabel);
  ($("goalSaveBtn").textContent = t.save);
  (goalStatus.textContent = goalInput.value ? t.saved : t.goalUnset);
  ($("overlayTitle").textContent = t.overlayTitle);
  ($("copyChatBtn").textContent = t.copyLink);
  ($("copyGoalBtn").textContent = t.copyLink);
  ($("overlayNote").textContent = t.overlayNote);
  ($("aboutTitle").textContent = t.aboutTitle);
  ($("aboutText").textContent = t.aboutText);
  ($("aboutLicense").textContent = t.aboutLicense);
  ($("updateBtn").textContent = t.updateBtn);
  langBtn.textContent = lang === "fa" ? "English" : "فارسی";
}

langBtn.addEventListener("click", () => {
  lang = lang === "fa" ? "en" : "fa";
  localStorage.setItem("rechat-lang", lang);
  applyLang();
});

$("connectBtn").addEventListener("click", () => {
  const channel = channelInput.value.trim();
  localStorage.setItem("rechat-channel", channel);
  if (!channel) return;
  if (isTauri) {
    void invoke("connect_chat", { channel }).catch(() => {
      renderStatus("error", channel, "فراخوانی ناموفق بود");
    });
    renderStatus("resolving", channel);
  } else {
    renderStatus("idle");
    chatStatus.textContent = dict[lang].saved;
  }
});
$("disconnectBtn").addEventListener("click", () => {
  if (isTauri) void invoke("disconnect_chat").catch(() => undefined);
  renderStatus("idle");
});
function renderGoalStatus(state: string, detail?: string): void {
  const t = dict[lang];
  let s: string;
  switch (state) {
    case "live":
      s = t.goalLive;
      break;
    case "loading":
      s = t.goalLoading;
      break;
    case "error":
      s = t.goalError;
      break;
    default:
      s = t.goalUnset;
  }
  if (detail) s += ` — ${detail}`;
  goalStatus.textContent = s;
  goalStatus.style.background =
    state === "live" ? "#16a34a" : state === "error" ? "#dc2626" : "";
}

$("goalSaveBtn").addEventListener("click", () => {
  const link = goalInput.value.trim();
  localStorage.setItem("rechat-goal", link);
  if (!link) {
    renderGoalStatus("idle");
    return;
  }
  if (isTauri) {
    void invoke("connect_goal", { link }).catch(() => {
      renderGoalStatus("error", "فراخوانی ناموفق بود");
    });
    renderGoalStatus("loading");
  } else {
    goalStatus.textContent = dict[lang].saved;
  }
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleFilterSave(): void {
  const f = currentFilters();
  localStorage.setItem("rechat-filters", JSON.stringify(f));
  if (!isTauri) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void invoke("save_filters", { filters: f }).catch(() => undefined);
  }, 400);
}
for (const el of [hideCmdChk, usersTa, botsTa, wordsTa]) {
  el.addEventListener("input", scheduleFilterSave);
  el.addEventListener("change", scheduleFilterSave);
}

const chatUrl = $<HTMLInputElement>("chatUrl");
const goalUrl = $<HTMLInputElement>("goalUrl");
chatUrl.value = `${base}/chat`;
goalUrl.value = `${base}/goal`;

async function copy(input: HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  const prev = btn.textContent;
  btn.textContent = dict[lang].copied;
  setTimeout(() => (btn.textContent = prev), 1500);
}
$("copyChatBtn").addEventListener("click", (e) => void copy(chatUrl, e.currentTarget as HTMLButtonElement));
$("copyGoalBtn").addEventListener("click", (e) => void copy(goalUrl, e.currentTarget as HTMLButtonElement));

applyLang();

// Restore live state from the backend when running inside Tauri.
if (isTauri) {
  void invoke<{ state: string; channel?: string; detail?: string }>("chat_status")
    .then((s) => renderStatus(s.state, s.channel, s.detail))
    .catch(() => undefined);
  void invoke<Filters>("get_filters")
    .then((f) => {
      applyFiltersToUi(f);
      localStorage.setItem("rechat-filters", JSON.stringify(f));
    })
    .catch(() => undefined);
  void listen<{ state: string; channel?: string; detail?: string }>("chat-status", (e) => {
    renderStatus(e.payload.state, e.payload.channel, e.payload.detail);
  }).catch(() => undefined);
  void invoke<{ state: string; detail?: string }>("goal_status")
    .then((s) => renderGoalStatus(s.state, s.detail))
    .catch(() => undefined);
  void listen<{ state: string; detail?: string }>("goal-status", (e) => {
    renderGoalStatus(e.payload.state, e.payload.detail);
  }).catch(() => undefined);
}

// ---------- M4: customization + profiles ----------

type Theme = {
  chat_font_size: number;
  chat_bg_opacity: number;
  chat_text_color: string;
  chat_radius: number;
  chat_gap: number;
  show_badges: boolean;
  show_username_color: boolean;
  max_messages: number;
  goal_title_size: number;
  goal_bar_c1: string;
  goal_bar_c2: string;
  goal_bar_height: number;
  show_goal_values: boolean;
  custom_css: string;
};
type ThemesDoc = { profiles: Record<string, Theme>; active: string };

function defaultTheme(): Theme {
  return {
    chat_font_size: 18,
    chat_bg_opacity: 0.55,
    chat_text_color: "#ffffff",
    chat_radius: 10,
    chat_gap: 8,
    show_badges: true,
    show_username_color: true,
    max_messages: 50,
    goal_title_size: 20,
    goal_bar_c1: "#16a34a",
    goal_bar_c2: "#4ade80",
    goal_bar_height: 22,
    show_goal_values: true,
    custom_css: "",
  };
}

// Mirrors theme.rs Theme::css (keep the two in sync).
function buildThemeCss(t: Theme): string {
  let css = `:root{--chat-font-size:${t.chat_font_size}px;--chat-bg-opacity:${t.chat_bg_opacity};--chat-text:${t.chat_text_color};--chat-radius:${t.chat_radius}px;--chat-gap:${t.chat_gap}px;--goal-title-size:${t.goal_title_size}px;--goal-bar-h:${t.goal_bar_height}px;--goal-c1:${t.goal_bar_c1};--goal-c2:${t.goal_bar_c2};}`;
  if (!t.show_badges) css += ".msg .badge,.msg .badge-img{display:none!important}";
  if (!t.show_username_color) css += ".msg .user{color:var(--chat-text)!important}";
  if (!t.show_goal_values) css += "#goal .values{display:none!important}";
  if (t.custom_css.trim()) css += "\n" + t.custom_css;
  return css;
}

const profileSel = $<HTMLSelectElement>("profileSel");
const newProfileName = $<HTMLInputElement>("newProfileName");
const ioTa = $<HTMLTextAreaElement>("ioTa");
const cssTa = $<HTMLTextAreaElement>("cssTa");
const cssHiCode = document.querySelector("#cssHi code") as HTMLElement;
const cssHiPre = document.getElementById("cssHi") as HTMLPreElement;
const previewFrame = $<HTMLIFrameElement>("preview");

let themesDoc: ThemesDoc = { profiles: { default: defaultTheme() }, active: "default" };
let currentProfile = "default";
let prevKind: "chat" | "goal" = "chat";
let baseOverlayCss = "";

const num = (el: HTMLInputElement, fallback: number): number => {
  const v = Number(el.value);
  return Number.isFinite(v) ? v : fallback;
};

function themeFromControls(): Theme {
  return {
    chat_font_size: num($<HTMLInputElement>("thChatSize"), 18),
    chat_bg_opacity: num($<HTMLInputElement>("thChatOpacity"), 0.55),
    chat_text_color: $<HTMLInputElement>("thChatText").value || "#ffffff",
    chat_radius: num($<HTMLInputElement>("thChatRadius"), 10),
    chat_gap: num($<HTMLInputElement>("thChatGap"), 8),
    show_badges: $<HTMLInputElement>("thBadges").checked,
    show_username_color: $<HTMLInputElement>("thUserColor").checked,
    max_messages: num($<HTMLInputElement>("thMaxMsg"), 50),
    goal_title_size: num($<HTMLInputElement>("thGoalTitle"), 20),
    goal_bar_c1: $<HTMLInputElement>("thGoalC1").value || "#16a34a",
    goal_bar_c2: $<HTMLInputElement>("thGoalC2").value || "#4ade80",
    goal_bar_height: num($<HTMLInputElement>("thGoalH"), 22),
    show_goal_values: $<HTMLInputElement>("thGoalValues").checked,
    custom_css: cssTa.value,
  };
}

function loadThemeIntoControls(t: Theme): void {
  $<HTMLInputElement>("thChatSize").value = String(t.chat_font_size);
  $<HTMLInputElement>("thChatOpacity").value = String(t.chat_bg_opacity);
  $<HTMLInputElement>("thChatText").value = t.chat_text_color;
  $<HTMLInputElement>("thChatRadius").value = String(t.chat_radius);
  $<HTMLInputElement>("thChatGap").value = String(t.chat_gap);
  $<HTMLInputElement>("thBadges").checked = t.show_badges;
  $<HTMLInputElement>("thUserColor").checked = t.show_username_color;
  $<HTMLInputElement>("thMaxMsg").value = String(t.max_messages);
  $<HTMLInputElement>("thGoalTitle").value = String(t.goal_title_size);
  $<HTMLInputElement>("thGoalC1").value = t.goal_bar_c1;
  $<HTMLInputElement>("thGoalC2").value = t.goal_bar_c2;
  $<HTMLInputElement>("thGoalH").value = String(t.goal_bar_height);
  $<HTMLInputElement>("thGoalValues").checked = t.show_goal_values;
  cssTa.value = t.custom_css;
  syncCssHighlight();
}

function renderProfileSelect(): void {
  profileSel.innerHTML = "";
  for (const name of Object.keys(themesDoc.profiles).sort()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    profileSel.appendChild(opt);
  }
  profileSel.value = currentProfile;
}

function previewDoc(kind: "chat" | "goal"): string {
  const css = buildThemeCss(themeFromControls());
  const head = `<meta charset="utf-8"><style>${baseOverlayCss}</style><style>${css}</style>`;
  if (kind === "chat") {
    return `<!doctype html><html dir="rtl"><head>${head}</head><body><div id="pinned"><div class="msg" dir="rtl"><span class="badge moderator">مدیر</span><span class="user" style="color:#4ade80">tahaa</span>: این پیام پین‌شده است</div></div><div id="messages"><div class="msg" dir="rtl"><span class="badge moderator">مدیر</span><span class="user" style="color:#4ade80">tahaa</span>: سلام به همه! بازی امشب سولزلایک است</div><div class="msg" dir="ltr"><span class="user" style="color:#58a6ff">soul_fan</span>: this boss fight is insane 🔥</div><div class="msg" dir="rtl"><span class="badge vip">VIP</span><span class="user" style="color:#f472b6">nightowl</span>: چت فارسی و انگلیسی قاطی هم خوب درمیاد، great stream!</div></div></body></html>`;
  }
  return `<!doctype html><html dir="rtl"><head>${head}</head><body><div id="goal"><div class="title">ارتقا استریم</div><div class="values"><span>۱۲٬۵۰۰٬۰۰۰</span> از <span>۳۰٬۰۰۰٬۰۰۰</span> <span>تومان</span> — <span>۴۲٪</span></div><div class="bar"><div class="fill" style="width:42%"></div></div><div id="goalError"></div></div></body></html>`;
}

function updatePreview(): void {
  previewFrame.srcdoc = previewDoc(prevKind);
}

function escLite(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCss(src: string): string {
  return escLite(src).replace(
    /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[a-zA-Z-]+)|([a-zA-Z-]+(?=\s*:))|(\b\d+(?:\.\d+)?(?:px|em|rem|%|s|ms)?\b)|(!important)/g,
    (_m, com, str, at, prop, num, imp) => {
      if (com) return `<span class="tok-com">${com}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (at) return `<span class="tok-at">${at}</span>`;
      if (prop) return `<span class="tok-prop">${prop}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      if (imp) return `<span class="tok-imp">${imp}</span>`;
      return _m;
    },
  );
}

function syncCssHighlight(): void {
  cssHiCode.innerHTML = highlightCss(cssTa.value) + "\n";
}

cssTa.addEventListener("input", () => {
  syncCssHighlight();
  updatePreview();
  scheduleThemeSave();
});
cssTa.addEventListener("scroll", () => {
  cssHiPre.scrollTop = cssTa.scrollTop;
  cssHiPre.scrollLeft = cssTa.scrollLeft;
});

let themeSaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleThemeSave(): void {
  const theme = themeFromControls();
  if (!isTauri) {
    themesDoc.profiles[currentProfile] = theme;
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
    return;
  }
  clearTimeout(themeSaveTimer);
  themeSaveTimer = setTimeout(() => {
    void invoke("save_theme", { profile: currentProfile, theme }).catch(() => undefined);
  }, 500);
}

for (const id of [
  "thChatSize", "thChatOpacity", "thChatText", "thChatRadius", "thChatGap",
  "thBadges", "thUserColor", "thMaxMsg", "thGoalTitle", "thGoalC1",
  "thGoalC2", "thGoalH", "thGoalValues",
]) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener("input", () => {
    updatePreview();
    scheduleThemeSave();
  });
}

profileSel.addEventListener("change", () => {
  currentProfile = profileSel.value;
  loadThemeIntoControls(themesDoc.profiles[currentProfile] ?? defaultTheme());
  updatePreview();
  if (isTauri) {
    void invoke("set_active_profile", { name: currentProfile }).catch(() => undefined);
  } else {
    themesDoc.active = currentProfile;
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
  }
});

async function reloadThemes(select?: string): Promise<void> {
  if (isTauri) {
    try {
      themesDoc = await invoke<ThemesDoc>("get_themes");
    } catch {
      // Keep the local copy; backend stays authoritative on next save.
    }
  } else {
    try {
      const raw = localStorage.getItem("rechat-themes");
      if (raw) themesDoc = JSON.parse(raw) as ThemesDoc;
    } catch {
      // Corrupt mirror: keep defaults.
    }
  }
  currentProfile = select ?? themesDoc.active;
  if (!themesDoc.profiles[currentProfile]) currentProfile = "default";
  renderProfileSelect();
  loadThemeIntoControls(themesDoc.profiles[currentProfile] ?? defaultTheme());
  updatePreview();
}

$("newProfileBtn").addEventListener("click", () => {
  const name = newProfileName.value.trim();
  if (!name) return;
  if (isTauri) {
    void invoke("create_profile", { name })
      .then(() => void reloadThemes(name))
      .catch(() => undefined);
  } else {
    if (!themesDoc.profiles[name]) themesDoc.profiles[name] = defaultTheme();
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
    void reloadThemes(name);
  }
});
$("renameProfileBtn").addEventListener("click", () => {
  const name = newProfileName.value.trim();
  if (!name || name === currentProfile) return;
  if (isTauri) {
    void invoke("rename_profile", { old: currentProfile, new: name })
      .then(() => void reloadThemes(name))
      .catch(() => undefined);
  } else {
    themesDoc.profiles[name] = themesDoc.profiles[currentProfile];
    delete themesDoc.profiles[currentProfile];
    if (themesDoc.active === currentProfile) themesDoc.active = name;
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
    void reloadThemes(name);
  }
});
$("dupProfileBtn").addEventListener("click", () => {
  const name = newProfileName.value.trim();
  if (!name) return;
  if (isTauri) {
    void invoke("duplicate_profile", { name: currentProfile, newName: name })
      .then(() => void reloadThemes(name))
      .catch(() => undefined);
  } else {
    themesDoc.profiles[name] = { ...themesDoc.profiles[currentProfile] };
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
    void reloadThemes(name);
  }
});
$("delProfileBtn").addEventListener("click", () => {
  if (currentProfile === "default") return;
  if (isTauri) {
    void invoke("delete_profile", { name: currentProfile })
      .then(() => void reloadThemes())
      .catch(() => undefined);
  } else {
    delete themesDoc.profiles[currentProfile];
    if (themesDoc.active === currentProfile) themesDoc.active = "default";
    localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
    void reloadThemes();
  }
});
$("exportBtn").addEventListener("click", () => {
  if (isTauri) {
    void invoke<string>("export_themes")
      .then((json) => {
        ioTa.value = json;
      })
      .catch(() => undefined);
  } else {
    ioTa.value = JSON.stringify(themesDoc, null, 2);
  }
});
$("importBtn").addEventListener("click", () => {
  const json = ioTa.value.trim();
  if (!json) return;
  if (isTauri) {
    void invoke("import_themes", { json })
      .then(() => void reloadThemes())
      .catch(() => undefined);
  } else {
    try {
      themesDoc = JSON.parse(json) as ThemesDoc;
      localStorage.setItem("rechat-themes", JSON.stringify(themesDoc));
      void reloadThemes();
    } catch {
      // Invalid JSON: leave everything as is.
    }
  }
});

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const prev = btn.textContent;
  btn.textContent = dict[lang].copied;
  setTimeout(() => (btn.textContent = prev), 1500);
}
$("copyChatProfileBtn").addEventListener("click", (e) => {
  const q = currentProfile === "default" ? "" : `?profile=${encodeURIComponent(currentProfile)}`;
  void copyText(`${base}/chat${q}`, e.currentTarget as HTMLButtonElement);
});
$("copyGoalProfileBtn").addEventListener("click", (e) => {
  const q = currentProfile === "default" ? "" : `?profile=${encodeURIComponent(currentProfile)}`;
  void copyText(`${base}/goal${q}`, e.currentTarget as HTMLButtonElement);
});

$("cssSampleBtn").addEventListener("click", () => {
  const sample = `.msg {\n  border: 2px solid #22c55e;\n  font-weight: 700;\n}\n.msg .user {\n  font-size: 20px;\n}\n`;
  cssTa.value = cssTa.value ? cssTa.value + "\n" + sample : sample;
  syncCssHighlight();
  updatePreview();
  scheduleThemeSave();
});
$("cssDocsBtn").addEventListener("click", () => {
  const docs = document.getElementById("cssDocs") as HTMLDivElement;
  docs.hidden = !docs.hidden;
});
$("prevChatBtn").addEventListener("click", () => {
  prevKind = "chat";
  updatePreview();
});
$("prevGoalBtn").addEventListener("click", () => {
  prevKind = "goal";
  updatePreview();
});

// The overlay stylesheet is a hashed asset in the build, so find it
// through chat.html's stylesheet link (works in vite dev and in Tauri).
async function loadBaseCss(): Promise<void> {
  try {
    const html = await (await fetch("./chat.html")).text();
    const m = html.match(/href="([^"]*overlay[^"]*\.css)"/);
    if (m) {
      const r = await fetch(m[1]);
      if (r.ok) baseOverlayCss = await r.text();
    }
  } catch {
    // No base styles: the preview still shows structure + theme vars.
  }
  updatePreview();
}
void loadBaseCss();
void reloadThemes();

// Built-in updater (M7): the plugin's own dialog (dialog: true in
// tauri.conf.json) asks the user and shows the release notes; this
// code only triggers the check and reports the no-update/failure cases.
async function runUpdateCheck(manual: boolean): Promise<void> {
  if (!isTauri) return;
  const status = $("updateStatus");
  const t = dict[lang];
  status.textContent = t.updateChecking;
  try {
    const update = await checkUpdate();
    // With dialog enabled, an available update already showed the
    // plugin dialog; null means already up to date.
    status.textContent = update ? "" : t.updateLatest;
  } catch {
    status.textContent = manual ? t.updateFailed : "";
  }
}
$("updateBtn").addEventListener("click", () => void runUpdateCheck(true));
// Auto-check once at startup (silent unless an update dialog appears).
void runUpdateCheck(false);
