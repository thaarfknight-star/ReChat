// ReChat settings UI (M2: live chat connect + filters via Tauri commands;
// M8: nav pages, fixed dual preview, accordion customization, presets,
// Kick OAuth auto-connect, separate app-settings page.
// Outside Tauri (plain browser dev) the buttons degrade to local save.)

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";

type Lang = "fa" | "en";
type ChatState = "idle" | "resolving" | "connecting" | "connected" | "reconnecting" | "error";

const dict: Record<Lang, Record<string, string>> = {
  fa: {
    tagline: "چت و Goal کیک، برای Meld Studio",
    navConnect: "اتصال",
    navCustomize: "شخصی‌سازی",
    navGuide: "راهنمای Meld",
    navSettings: "تنظیمات برنامه",
    kickAutoTitle: "اتصال خودکار با Kick",
    kickAutoNote: "با حساب کیک خودت وارد شو تا ReChat خودش کانالت را پیدا کند و چت را وصل کند؛ دیگر لازم نیست لینک کانال بدهی.",
    kickClientIdLabel: "Client ID برنامه‌ی Kick",
    kickSecretLabel: "Client Secret برنامه‌ی Kick",
    kickSave: "ذخیره",
    kickGuideSummary: "راهنمای ساخت برنامه‌ی Kick",
    kickGuideText: "در kick.com وارد شو، به Settings → Developer برو و یک برنامه بساز؛ Redirect URI را دقیقاً http://localhost:17874/oauth/callback بگذار و اسکوپ‌های user:read و channel:read را بده. بعد Client ID و Client Secret را اینجا ذخیره کن و «اتصال با Kick» را بزن؛ مرورگر باز می‌شود، دسترسی را تأیید می‌کنی و چت خودکار وصل می‌شود. این دو مقدار فقط روی همین سیستم می‌ماند.",
    kickConnect: "اتصال با Kick",
    kickDisconnect: "قطع اتصال Kick",
    kickNotConnected: "وصل نیست",
    kickConnected: "متصل به Kick",
    kickWaiting: "در مرورگر دسترسی را تأیید کن…",
    kickNeedConfig: "اول Client ID و Client Secret را ذخیره کن.",
    kickFailed: "اتصال Kick ناموفق بود",
    chatTitle: "چت کیک",
    channelLabel: "نام کانال یا لینک کانال (روش دستی، وقتی اتصال خودکار تنظیم نشده)",
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
    accChat: "چت",
    accGoal: "Goal",
    accPresets: "تم‌های آماده",
    accCss: "CSS سفارشی",
    presetNote: "با زدن هر تم، رنگ‌ها و CSS سفارشی همین پروفایل جایگزین می‌شود؛ پیش‌نمایش سمت راست همان لحظه عوض می‌شود.",
    cssSample: "CSS نمونه",
    cssFormat: "مرتب‌سازی",
    cssHint: "Ctrl+Space پیشنهاد هوشمند می‌دهد؛ Tab دو فاصله می‌گذارد؛ براکت‌ها خودکار بسته می‌شوند.",
    cssDocs: "راهنمای کلاس‌ها",
    prevChatLabel: "پیش‌نمایش چت",
    prevGoalLabel: "پیش‌نمایش Goal",
    previewNote: "پیش‌نمایش‌ها همیشه همین‌جا می‌مانند و با هر تغییری در شخصی‌سازی همان لحظه تازه می‌شوند.",
    meldGuideTitle: "راهنمای Meld Studio",
    meldGuideIntro: "پس‌زمینه‌ی اورلی‌ها کاملاً شفاف است؛ نیازی به Chroma Key نیست. مصرف هم سبک است: چت فقط با رویداد زنده می‌آید و سقف پیام دارد، و Goal هر ۱۰ ثانیه یک‌بار خوانده می‌شود.",
    meldStep1: "ReChat را اجرا کن؛ با «اتصال با Kick» وارد شو (یا در بخش چت نام کانال را بزن و «اتصال» را بزن) تا وضعیت «متصل ✓» شود.",
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
    overlayNote: "این لینک‌ها را در Meld به‌عنوان Browser Source اضافه کنید.",
    settingsTitle: "تنظیمات برنامه",
    langLabel: "زبان برنامه",
    autoUpdateLabel: "بررسی خودکار به‌روزرسانی هنگام اجرای برنامه",
    versionNote: "نسخه‌ی ۰٫۲٫۲",
    aboutTitle: "درباره‌ی ReChat",
    aboutText: "نسخه‌ی ۰٫۲٫۲ (M8.2 — فیکس چیدمان + فایل آپدیت داخل تگ). چت و Goal کیک را می‌گیرد و به‌صورت اورلی شفاف به Meld می‌دهد. تنظیمات فقط روی همین سیستم می‌ماند.",
    aboutLicense: "لایسنس: دوگانه‌ی MIT/Apache-2.0 — © 2026 Taha Arefi. متن کامل لایسنس‌ها همراه نصب‌کننده است.",
    updateBtn: "بررسی به‌روزرسانی",
    updateConfirm: "نسخه‌ی تازه‌ی {v} آمده است. نصب شود؟",
    updateDownloading: "در حال دانلود آپدیت…",
    updateInstalled: "آپدیت نصب شد؛ برنامه در حال راه‌اندازی دوباره است…",
    trayNote: "بستن پنجره (×) برنامه را به سینی سیستم (tray) می‌برد و سرور اورلی در پس‌زمینه همچنان کار می‌کند؛ با کلیک روی آیکن tray برمی‌گردد.",
    quitApp: "خروج کامل از برنامه",
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
    navConnect: "Connect",
    navCustomize: "Customize",
    navGuide: "Meld guide",
    navSettings: "App settings",
    kickAutoTitle: "Auto-connect with Kick",
    kickAutoNote: "Sign in with your Kick account and ReChat finds your channel and connects chat itself — no channel link needed.",
    kickClientIdLabel: "Kick app Client ID",
    kickSecretLabel: "Kick app Client Secret",
    kickSave: "Save",
    kickGuideSummary: "How to create a Kick app",
    kickGuideText: "Sign in at kick.com, go to Settings → Developer and create an app; set the Redirect URI to exactly http://localhost:17874/oauth/callback and grant the user:read and channel:read scopes. Then save the Client ID and Client Secret here and hit “Connect with Kick”; the browser opens, you approve access, and chat connects automatically. Both values stay on this machine only.",
    kickConnect: "Connect with Kick",
    kickDisconnect: "Disconnect Kick",
    kickNotConnected: "Not connected",
    kickConnected: "Connected to Kick",
    kickWaiting: "Approve access in the browser…",
    kickNeedConfig: "Save the Client ID and Client Secret first.",
    kickFailed: "Kick connection failed",
    chatTitle: "Kick chat",
    channelLabel: "Channel name or channel URL (manual method, when auto-connect is not set up)",
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
    accChat: "Chat",
    accGoal: "Goal",
    accPresets: "Ready themes",
    accCss: "Custom CSS",
    presetNote: "Applying a theme replaces this profile's colors and custom CSS; the preview on the right updates instantly.",
    cssSample: "Sample CSS",
    cssFormat: "Format",
    cssHint: "Ctrl+Space shows smart suggestions; Tab inserts two spaces; brackets auto-close.",
    cssDocs: "Class guide",
    prevChatLabel: "Chat preview",
    prevGoalLabel: "Goal preview",
    previewNote: "The previews stay here and refresh instantly with every customization change.",
    meldGuideTitle: "Meld Studio guide",
    meldGuideIntro: "Overlay backgrounds are fully transparent; no Chroma Key needed. Footprint is light: chat arrives on live events only with a message cap, and the goal is read once every 10 seconds.",
    meldStep1: "Run ReChat; sign in with “Connect with Kick” (or enter the channel name in the chat section and hit Connect) until the status shows Connected ✓.",
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
    overlayNote: "Add these links in Meld as a Browser Source.",
    settingsTitle: "App settings",
    langLabel: "App language",
    autoUpdateLabel: "Check for updates automatically on startup",
    versionNote: "Version 0.2.2",
    aboutTitle: "About ReChat",
    aboutText: "Version 0.2.2 (M8.2 — layout fix + update file in tag). Takes Kick chat and Goal and hands them to Meld as transparent overlays. Settings stay on this machine.",
    aboutLicense: "License: dual MIT/Apache-2.0 — © 2026 Taha Arefi. Full license texts ship with the installer.",
    updateBtn: "Check for updates",
    updateConfirm: "A new version {v} is available. Install it?",
    updateDownloading: "Downloading update…",
    updateInstalled: "Update installed; restarting…",
    trayNote: "Closing the window (×) sends the app to the system tray and the overlay server keeps running in the background; click the tray icon to bring it back.",
    quitApp: "Quit app completely",
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
const shell = $("shell");

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
  chatStatus.classList.toggle("ok", state === "connected");
  chatStatus.style.background = state === "connected" ? "#16a34a" : state === "error" ? "#dc2626" : "";
}

const chatUrl = $<HTMLInputElement>("chatUrl");
const goalUrl = $<HTMLInputElement>("goalUrl");

function refreshOverlayUrls(): void {
  chatUrl.value = `${base}/chat?lang=${lang}`;
  goalUrl.value = `${base}/goal?lang=${lang}`;
}

function applyLang(): void {
  const t = dict[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  shell.classList.toggle("ltr", lang === "en");
  ($("tagline").textContent = t.tagline);
  ($("navConnect").textContent = t.navConnect);
  ($("navCustomize").textContent = t.navCustomize);
  ($("navGuide").textContent = t.navGuide);
  ($("navSettings").textContent = t.navSettings);
  ($("kickAutoTitle").textContent = t.kickAutoTitle);
  ($("kickAutoNote").textContent = t.kickAutoNote);
  ($("kickClientIdLabel").textContent = t.kickClientIdLabel);
  ($("kickSecretLabel").textContent = t.kickSecretLabel);
  ($("kickSaveBtn").textContent = t.kickSave);
  ($("kickGuideSummary").textContent = t.kickGuideSummary);
  ($("kickGuideText").textContent = t.kickGuideText);
  ($("kickConnectBtn").textContent = t.kickConnect);
  ($("kickDisconnectBtn").textContent = t.kickDisconnect);
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
  ($("accChatLabel").textContent = t.accChat);
  ($("accGoalLabel").textContent = t.accGoal);
  ($("accPresetsLabel").textContent = t.accPresets);
  ($("accCssLabel").textContent = t.accCss);
  ($("presetNote").textContent = t.presetNote);
  ($("cssSampleBtn").textContent = t.cssSample);
  ($("cssFormatBtn").textContent = t.cssFormat);
  ($("cssHint").textContent = t.cssHint);
  ($("cssDocsBtn").textContent = t.cssDocs);
  ($("prevChatLabel").textContent = t.prevChatLabel);
  ($("prevGoalLabel").textContent = t.prevGoalLabel);
  ($("previewNote").textContent = t.previewNote);
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
  ($("settingsTitle").textContent = t.settingsTitle);
  ($("langLabel").textContent = t.langLabel);
  ($("autoUpdateLabel").textContent = t.autoUpdateLabel);
  ($("versionNote").textContent = t.versionNote);
  ($("aboutTitle").textContent = t.aboutTitle);
  ($("aboutText").textContent = t.aboutText);
  ($("aboutLicense").textContent = t.aboutLicense);
  ($("updateBtn").textContent = t.updateBtn);
  ($("trayNote").textContent = t.trayNote);
  ($("quitBtn").textContent = t.quitApp);
  channelInput.placeholder = lang === "fa" ? "kick.com/tahaa" : "kick.com/username";
  goalInput.placeholder = "https://…";
  ($("newProfileName") as HTMLInputElement).placeholder =
    lang === "fa" ? "نام پروفایل تازه" : "New profile name";
  ($("ioTa") as HTMLTextAreaElement).placeholder =
    lang === "fa" ? "JSON پروفایل‌ها برای ورودی/خروجی" : "Profiles JSON for import/export";
  ($("kickClientId") as HTMLInputElement).placeholder = lang === "fa" ? "مثال: 01K…" : "e.g. 01K…";
  ($("kickSecret") as HTMLInputElement).placeholder =
    lang === "fa" ? "خالی بماند یعنی قبلی حفظ شود" : "Leave empty to keep the saved one";
  langBtn.textContent = lang === "fa" ? "English" : "فارسی";
  renderPresetNames();
  refreshOverlayUrls();
}

function setLang(next: Lang): void {
  lang = next;
  localStorage.setItem("rechat-lang", lang);
  applyLang();
  void refreshKickUi();
}

langBtn.addEventListener("click", () => setLang(lang === "fa" ? "en" : "fa"));
$("langFaBtn").addEventListener("click", () => setLang("fa"));
$("langEnBtn").addEventListener("click", () => setLang("en"));

// ---------- Nav pages ----------
for (const btn of document.querySelectorAll<HTMLButtonElement>("#mainNav button")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>("#mainNav button")) {
      b.classList.toggle("active", b === btn);
    }
    for (const page of document.querySelectorAll<HTMLElement>(".page")) {
      page.hidden = page.id !== `page-${btn.dataset.page}`;
    }
  });
}

// ---------- Accordion ----------
for (const head of document.querySelectorAll<HTMLButtonElement>(".acc-head")) {
  head.addEventListener("click", () => {
    const section = head.closest(".acc") as HTMLElement;
    const body = document.getElementById(head.dataset.acc as string) as HTMLElement;
    const open = section.classList.toggle("open");
    body.hidden = !open;
  });
}

// ---------- Manual chat connect (fallback) ----------
$("connectBtn").addEventListener("click", () => {
  const channel = channelInput.value.trim();
  localStorage.setItem("rechat-channel", channel);
  if (!channel) return;
  localStorage.setItem("rechat-auto-chat", "1");
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
  localStorage.removeItem("rechat-auto-chat");
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

// ---------- Kick OAuth auto-connect ----------
type KickOauthState = {
  client_id: string;
  has_secret: boolean;
  connected: boolean;
  username?: string;
  slug?: string;
};

const kickStatus = $("kickStatus");
const kickClientId = $<HTMLInputElement>("kickClientId");
const kickSecret = $<HTMLInputElement>("kickSecret");
const kickSavedNote = $("kickSavedNote");

function renderKick(s: KickOauthState): void {
  const t = dict[lang];
  kickClientId.value = s.client_id;
  if (s.connected) {
    kickStatus.textContent = `${t.kickConnected} (${s.username ?? s.slug ?? ""})`;
    kickStatus.classList.add("ok");
    kickStatus.style.background = "#16a34a";
  } else {
    kickStatus.textContent = t.kickNotConnected;
    kickStatus.classList.remove("ok");
    kickStatus.style.background = "";
  }
}

async function refreshKickUi(): Promise<KickOauthState | null> {
  if (!isTauri) return null;
  try {
    const s = await invoke<KickOauthState>("get_kick_oauth_config");
    renderKick(s);
    return s;
  } catch {
    return null;
  }
}

$("kickSaveBtn").addEventListener("click", () => {
  if (!isTauri) {
    kickSavedNote.textContent = dict[lang].saved;
    return;
  }
  void invoke("save_kick_oauth_config", {
    clientId: kickClientId.value.trim(),
    clientSecret: kickSecret.value,
  })
    .then(() => {
      kickSecret.value = "";
      kickSavedNote.textContent = dict[lang].saved;
      return refreshKickUi();
    })
    .catch(() => undefined);
});

let kickPollTimer: ReturnType<typeof setInterval> | undefined;
$("kickConnectBtn").addEventListener("click", () => {
  if (!isTauri) return;
  void invoke("start_kick_oauth")
    .then(() => {
      kickStatus.textContent = dict[lang].kickWaiting;
      let tries = 0;
      clearInterval(kickPollTimer);
      kickPollTimer = setInterval(() => {
        tries += 1;
        void refreshKickUi().then((s) => {
          if (s?.connected || tries >= 60) {
            clearInterval(kickPollTimer);
            if (s?.connected) {
              void invoke("chat_status")
                .then((st) => {
                  const c = st as { state: string; channel?: string; detail?: string };
                  renderStatus(c.state, c.channel, c.detail);
                })
                .catch(() => undefined);
            }
          }
        });
      }, 2000);
    })
    .catch(() => {
      kickStatus.textContent = dict[lang].kickNeedConfig;
    });
});
$("kickDisconnectBtn").addEventListener("click", () => {
  if (!isTauri) return;
  clearInterval(kickPollTimer);
  void invoke("disconnect_kick_oauth")
    .then(() => void refreshKickUi())
    .catch(() => undefined);
  renderStatus("idle");
});

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
  // Auto-connect: Kick OAuth first, else the remembered manual channel.
  void refreshKickUi().then((s) => {
    if (s?.connected) {
      void invoke("auto_connect_kick").catch(() => undefined);
    } else if (localStorage.getItem("rechat-auto-chat") === "1" && channelInput.value.trim()) {
      void invoke("connect_chat", { channel: channelInput.value.trim() }).catch(() => undefined);
    }
  });
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

// ---------- M8: ready themes (colors + gradients + game looks) ----------
type Preset = {
  id: string;
  nameFa: string;
  nameEn: string;
  theme: Partial<Theme>;
};
const PRESETS: Preset[] = [
  { id: "neon", nameFa: "نئون پیش‌فرض", nameEn: "Neon default", theme: { chat_text_color: "#ffffff", chat_radius: 10, chat_gap: 8, goal_bar_c1: "#16a34a", goal_bar_c2: "#4ade80", goal_bar_height: 22, custom_css: "" } },
  { id: "fire", nameFa: "آتش", nameEn: "Fire", theme: { chat_text_color: "#fff7ed", chat_radius: 12, chat_gap: 8, goal_bar_c1: "#ea580c", goal_bar_c2: "#ef4444", goal_bar_height: 24, custom_css: ".msg{background:linear-gradient(90deg,rgba(124,45,18,.85),rgba(69,10,10,.85))}" } },
  { id: "ocean", nameFa: "اقیانوس", nameEn: "Ocean", theme: { chat_text_color: "#f0f9ff", chat_radius: 14, chat_gap: 10, goal_bar_c1: "#0284c7", goal_bar_c2: "#6366f1", goal_bar_height: 22, custom_css: ".msg{background:linear-gradient(90deg,rgba(8,47,73,.85),rgba(30,27,75,.85))}" } },
  { id: "forest", nameFa: "جنگل", nameEn: "Forest", theme: { chat_text_color: "#f0fdf4", chat_radius: 10, chat_gap: 8, goal_bar_c1: "#15803d", goal_bar_c2: "#a3e635", goal_bar_height: 22, custom_css: "" } },
  { id: "galaxy", nameFa: "کهکشان", nameEn: "Galaxy", theme: { chat_text_color: "#faf5ff", chat_radius: 16, chat_gap: 10, goal_bar_c1: "#9333ea", goal_bar_c2: "#ec4899", goal_bar_height: 24, custom_css: ".msg{background:linear-gradient(90deg,rgba(59,7,100,.85),rgba(80,7,36,.85))}" } },
  { id: "gold", nameFa: "طلایی", nameEn: "Gold", theme: { chat_text_color: "#fffbeb", chat_radius: 8, chat_gap: 8, goal_bar_c1: "#b45309", goal_bar_c2: "#fde68a", goal_bar_height: 22, custom_css: "" } },
  { id: "tactical", nameFa: "تاکتیکی (سبک CS)", nameEn: "Tactical (CS style)", theme: { chat_font_size: 20, chat_text_color: "#e7e5e4", chat_radius: 2, chat_gap: 6, goal_bar_c1: "#d97706", goal_bar_c2: "#f59e0b", goal_bar_height: 18, custom_css: ".msg{border:1px solid rgba(245,158,11,.5)}" } },
  { id: "gothic", nameFa: "گوتیک (سبک سولزلایک)", nameEn: "Gothic (soulslike style)", theme: { chat_text_color: "#e7e5e4", chat_radius: 4, chat_gap: 8, goal_bar_c1: "#991b1b", goal_bar_c2: "#450a0a", goal_bar_height: 20, custom_css: ".msg{background:linear-gradient(90deg,rgba(12,10,9,.9),rgba(69,10,10,.9));border:1px solid rgba(153,27,27,.6)}" } },
  { id: "cyber", nameFa: "سایبر", nameEn: "Cyber", theme: { chat_text_color: "#ecfeff", chat_radius: 14, chat_gap: 10, goal_bar_c1: "#06b6d4", goal_bar_c2: "#3b82f6", goal_bar_height: 22, custom_css: ".msg{background:linear-gradient(90deg,rgba(8,51,68,.85),rgba(23,37,84,.85))}" } },
  { id: "pink", nameFa: "صورتی استریم", nameEn: "Stream pink", theme: { chat_text_color: "#fff1f2", chat_radius: 18, chat_gap: 10, goal_bar_c1: "#db2777", goal_bar_c2: "#8b5cf6", goal_bar_height: 24, custom_css: "" } },
];

function renderPresetNames(): void {
  const grid = document.getElementById("presetGrid") as HTMLDivElement;
  if (!grid) return;
  grid.innerHTML = "";
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.type = "button";
    const swatch = document.createElement("div");
    swatch.className = "preset-swatch";
    swatch.style.background = `linear-gradient(90deg, ${p.theme.goal_bar_c1 ?? "#16a34a"}, ${p.theme.goal_bar_c2 ?? "#4ade80"})`;
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = lang === "fa" ? p.nameFa : p.nameEn;
    btn.appendChild(swatch);
    btn.appendChild(name);
    btn.addEventListener("click", () => {
      const next = { ...themeFromControls(), ...p.theme };
      loadThemeIntoControls(next);
      updatePreview();
      scheduleThemeSave();
    });
    grid.appendChild(btn);
  }
}

const profileSel = $<HTMLSelectElement>("profileSel");
const newProfileName = $<HTMLInputElement>("newProfileName");
const ioTa = $<HTMLTextAreaElement>("ioTa");
const cssTa = $<HTMLTextAreaElement>("cssTa");
const cssHiCode = document.querySelector("#cssHi code") as HTMLElement;
const cssHiPre = document.getElementById("cssHi") as HTMLPreElement;
const previewChatFrame = $<HTMLIFrameElement>("previewChat");
const previewGoalFrame = $<HTMLIFrameElement>("previewGoal");

let themesDoc: ThemesDoc = { profiles: { default: defaultTheme() }, active: "default" };
let currentProfile = "default";
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
  syncCssGutter();
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
  const dir = lang === "fa" ? "rtl" : "ltr";
  const fmt = new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US");
  if (kind === "chat") {
    const mod = lang === "fa" ? "مدیر" : "Mod";
    return `<!doctype html><html dir="${dir}"><head>${head}</head><body><div id="pinned"><div class="msg" dir="rtl"><span class="badge moderator">${mod}</span><span class="user" style="color:#4ade80">tahaa</span>: ${lang === "fa" ? "این پیام پین‌شده است" : "This message is pinned"}</div></div><div id="messages"><div class="msg" dir="rtl"><span class="badge moderator">${mod}</span><span class="user" style="color:#4ade80">tahaa</span>: ${lang === "fa" ? "سلام به همه! بازی امشب سولزلایک است" : "Hey everyone! Tonight we play a soulslike"}</div><div class="msg" dir="ltr"><span class="user" style="color:#58a6ff">soul_fan</span>: this boss fight is insane 🔥</div><div class="msg" dir="rtl"><span class="badge vip">VIP</span><span class="user" style="color:#f472b6">nightowl</span>: ${lang === "fa" ? "چت فارسی و انگلیسی قاطی هم خوب درمیاد، great stream!" : "Persian and English chat mix nicely, great stream!"}</div></div></body></html>`;
  }
  const unit = lang === "fa" ? "تومان" : "Toman";
  return `<!doctype html><html dir="${dir}"><head>${head}</head><body><div id="goal"><div class="title">${lang === "fa" ? "ارتقا استریم" : "Stream upgrade"}</div><div class="values"><span>${fmt.format(12500000)}</span> ${lang === "fa" ? "از" : "of"} <span>${fmt.format(30000000)}</span> <span>${unit}</span> — <span>${fmt.format(42)}٪</span></div><div class="bar"><div class="fill" style="width:42%"></div></div><div id="goalError"></div></div></body></html>`;
}

function updatePreview(): void {
  previewChatFrame.srcdoc = previewDoc("chat");
  previewGoalFrame.srcdoc = previewDoc("goal");
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

const cssGutterInner = document.getElementById("cssGutterInner") as HTMLElement;
const cssAcPopup = document.getElementById("cssAcPopup") as HTMLDivElement;

function syncCssGutter(): void {
  const n = cssTa.value.split("\n").length;
  cssGutterInner.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join("\n");
  cssGutterInner.style.transform = `translateY(${-cssTa.scrollTop}px)`;
}

function afterCssEdit(): void {
  syncCssHighlight();
  syncCssGutter();
  updatePreview();
  scheduleThemeSave();
}

cssTa.addEventListener("input", (e) => {
  afterCssEdit();
  const data = (e as InputEvent).data;
  if (data && /[a-zA-Z0-9_#\-.%]/.test(data)) showAutocomplete(false);
});
cssTa.addEventListener("scroll", () => {
  cssHiPre.scrollTop = cssTa.scrollTop;
  cssHiPre.scrollLeft = cssTa.scrollLeft;
  cssGutterInner.style.transform = `translateY(${-cssTa.scrollTop}px)`;
});

// ---------- VSCode-style autocomplete (M8.1) ----------

type AcItem = { text: string; kind: string };
const CSS_SELECTORS: AcItem[] = [
  { text: ".msg", kind: "selector" }, { text: ".msg .user", kind: "selector" },
  { text: ".msg .badge", kind: "selector" }, { text: ".msg .badge-img", kind: "selector" },
  { text: ".msg .emote", kind: "selector" }, { text: "#pinned", kind: "selector" },
  { text: "#pinned .msg", kind: "selector" }, { text: "#messages", kind: "selector" },
  { text: "#chatStatus", kind: "selector" }, { text: "#goal", kind: "selector" },
  { text: "#goal .title", kind: "selector" }, { text: "#goal .values", kind: "selector" },
  { text: "#goal .bar", kind: "selector" }, { text: "#goal .fill", kind: "selector" },
  { text: "#goalError", kind: "selector" },
];
const CSS_VARS: AcItem[] = [
  "--chat-font-size", "--chat-bg-opacity", "--chat-text", "--chat-radius", "--chat-gap",
  "--goal-title-size", "--goal-bar-h", "--goal-c1", "--goal-c2",
].map((v) => ({ text: v, kind: "var" }));
const CSS_PROPS: AcItem[] = [
  "color", "background", "background-color", "background-image", "border", "border-radius",
  "padding", "margin", "font-size", "font-weight", "font-family", "display", "flex-direction",
  "gap", "width", "height", "max-width", "min-width", "opacity", "box-shadow", "text-shadow",
  "animation", "transition", "transform", "overflow", "text-align", "line-height",
  "letter-spacing", "word-spacing", "white-space", "cursor", "position", "top", "left",
  "right", "bottom", "z-index", "justify-content", "align-items", "flex-wrap",
  "grid-template-columns", "object-fit", "filter", "backdrop-filter", "outline",
  "visibility", "content", "list-style", "text-decoration", "text-transform",
  "vertical-align", "float", "clear", "clip-path", "resize", "user-select", "pointer-events",
].map((p) => ({ text: p, kind: "prop" }));
const CSS_VALUES: Record<string, string[]> = {
  display: ["block", "inline-block", "flex", "grid", "none"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  "font-weight": ["400", "700", "800", "bold"],
  "text-align": ["left", "right", "center"],
  overflow: ["hidden", "visible", "auto", "scroll"],
  "flex-direction": ["row", "column"],
  "justify-content": ["flex-start", "center", "space-between"],
  "align-items": ["flex-start", "center", "stretch"],
  "white-space": ["normal", "nowrap", "pre-wrap"],
  visibility: ["visible", "hidden"],
  color: ["#ffffff", "#000000", "transparent", "red", "orange", "gold", "lime", "cyan"],
  "background-color": ["#000000", "#ffffff", "transparent", "rgba(0,0,0,0.5)"],
};
const GENERIC_VALUES = ["inherit", "initial", "unset", "none", "auto", "0"];

let acItems: AcItem[] = [];
let acActive = 0;
let acOpen = false;

function cssContext(): "selector" | "property" | "value" | "var" {
  const before = cssTa.value.slice(0, cssTa.selectionStart);
  const lastVar = before.lastIndexOf("var(");
  if (lastVar >= 0 && !before.slice(lastVar).includes(")")) return "var";
  const lastOpen = before.lastIndexOf("{");
  const lastClose = before.lastIndexOf("}");
  if (lastOpen === -1 || lastClose > lastOpen) return "selector";
  const body = before.slice(lastOpen + 1);
  const lastSemi = body.lastIndexOf(";");
  const lastColon = body.lastIndexOf(":");
  if (lastColon > lastSemi) return "value";
  return "property";
}

function currentWord(): { word: string; start: number } {
  const pos = cssTa.selectionStart;
  let start = pos;
  while (start > 0 && /[a-zA-Z0-9_\-.#%]/.test(cssTa.value[start - 1])) start--;
  return { word: cssTa.value.slice(start, pos), start };
}

function caretPos(): { x: number; y: number; lineH: number } {
  const cs = getComputedStyle(cssTa);
  const mirror = document.createElement("div");
  mirror.style.cssText = `position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;box-sizing:${cs.boxSizing};font:${cs.font};line-height:${cs.lineHeight};padding:${cs.padding};width:${cssTa.clientWidth}px;`;
  mirror.textContent = cssTa.value.slice(0, cssTa.selectionStart);
  const span = document.createElement("span");
  span.textContent = "\u200b";
  mirror.appendChild(span);
  document.body.appendChild(mirror);
  const r = span.getBoundingClientRect();
  const ta = cssTa.getBoundingClientRect();
  document.body.removeChild(mirror);
  return { x: r.left - ta.left, y: r.top - ta.top, lineH: r.height || 21 };
}

function showAutocomplete(force: boolean): void {
  const ctx = cssContext();
  const { word } = currentWord();
  let pool: AcItem[] = [];
  if (ctx === "selector") pool = CSS_SELECTORS;
  else if (ctx === "var") pool = CSS_VARS;
  else if (ctx === "property") pool = CSS_PROPS;
  else {
    const before = cssTa.value.slice(0, cssTa.selectionStart);
    const m = before.match(/([a-zA-Z-]+)\s*:\s*[^;{}]*$/);
    const vals = (m ? CSS_VALUES[m[1]] : undefined) ?? GENERIC_VALUES;
    pool = vals.map((v) => ({ text: v, kind: "value" }));
  }
  const q = word.toLowerCase();
  const filtered = (force || q.length >= 1)
    ? pool.filter((it) => it.text.toLowerCase().startsWith(q) || (q.length >= 2 && it.text.toLowerCase().includes(q)))
    : [];
  if (filtered.length === 0) { closeAutocomplete(); return; }
  acItems = filtered.slice(0, 12);
  acActive = 0;
  acOpen = true;
  cssAcPopup.innerHTML = "";
  acItems.forEach((it, i) => {
    const div = document.createElement("div");
    div.className = "ac-item" + (i === 0 ? " active" : "");
    div.innerHTML = `<span class="ac-kind">${it.kind}</span>${it.text}`;
    div.addEventListener("mousedown", (e) => { e.preventDefault(); acceptSuggestion(i); });
    cssAcPopup.appendChild(div);
  });
  const { x, y, lineH } = caretPos();
  const ed = cssTa.parentElement as HTMLElement;
  cssAcPopup.hidden = false;
  const pw = Math.min(320, ed.clientWidth - 16);
  cssAcPopup.style.width = pw + "px";
  cssAcPopup.style.left = Math.max(4, Math.min(x, ed.clientWidth - pw - 4)) + "px";
  const ph = Math.min(220, acItems.length * 30 + 8);
  cssAcPopup.style.top = (y + lineH + ph > ed.clientHeight ? Math.max(4, y - ph) : y + lineH) + "px";
}

function closeAutocomplete(): void {
  acOpen = false;
  cssAcPopup.hidden = true;
}

function renderAcActive(): void {
  [...cssAcPopup.children].forEach((el, i) => el.classList.toggle("active", i === acActive));
  const active = cssAcPopup.children[acActive] as HTMLElement | undefined;
  active?.scrollIntoView({ block: "nearest" });
}

function acceptSuggestion(i: number): void {
  const item = acItems[i];
  if (!item) return;
  const { word, start } = currentWord();
  const ctx = cssContext();
  const end = cssTa.selectionStart;
  const val = cssTa.value;
  let insert = item.text;
  if (ctx === "property") insert += ": ";
  cssTa.value = val.slice(0, start) + insert + val.slice(end);
  const caret = start + insert.length;
  cssTa.selectionStart = cssTa.selectionEnd = caret;
  closeAutocomplete();
  afterCssEdit();
  if (ctx === "property") showAutocomplete(true);
  void word;
}

cssTa.addEventListener("keydown", (e) => {
  if (acOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    acActive = (acActive + (e.key === "ArrowDown" ? 1 : -1) + acItems.length) % acItems.length;
    renderAcActive();
    return;
  }
  if (acOpen && (e.key === "Enter" || e.key === "Tab")) {
    e.preventDefault();
    acceptSuggestion(acActive);
    return;
  }
  if (e.key === "Escape" && acOpen) { closeAutocomplete(); return; }
  if (e.key === " " && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    showAutocomplete(true);
    return;
  }
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]", '"': '"', "'": "'" };
  if (!e.ctrlKey && !e.metaKey && pairs[e.key]) {
    const s = cssTa.selectionStart;
    const next = cssTa.value[s];
    if ((e.key === '"' || e.key === "'") && next && /[\w]/.test(next)) return;
    e.preventDefault();
    const val = cssTa.value;
    cssTa.value = val.slice(0, s) + e.key + pairs[e.key] + val.slice(cssTa.selectionEnd);
    cssTa.selectionStart = cssTa.selectionEnd = s + 1;
    afterCssEdit();
    return;
  }
  if (!e.ctrlKey && !e.metaKey && (e.key === "}" || e.key === ")" || e.key === "]")) {
    if (cssTa.value[cssTa.selectionStart] === e.key) {
      e.preventDefault();
      cssTa.selectionStart = cssTa.selectionEnd = cssTa.selectionStart + 1;
    }
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const val = cssTa.value;
    const s = cssTa.selectionStart;
    const en = cssTa.selectionEnd;
    if (s !== en && val.slice(s, en).includes("\n")) {
      const startLine = val.lastIndexOf("\n", s - 1) + 1;
      const endIdx = val.indexOf("\n", en);
      const end = endIdx === -1 ? val.length : endIdx;
      const block = val.slice(startLine, end);
      const changed = block.split("\n").map((l) => e.shiftKey ? l.replace(/^  /, "") : "  " + l).join("\n");
      cssTa.value = val.slice(0, startLine) + changed + val.slice(end);
      cssTa.selectionStart = startLine;
      cssTa.selectionEnd = startLine + changed.length;
    } else {
      cssTa.value = val.slice(0, s) + "  " + val.slice(en);
      cssTa.selectionStart = cssTa.selectionEnd = s + 2;
    }
    afterCssEdit();
    return;
  }
});
cssTa.addEventListener("blur", () => setTimeout(closeAutocomplete, 120));

// ---------- CSS formatter (M8.1) ----------

function formatCss(src: string): string {
  let out = "";
  let indent = 0;
  let i = 0;
  let inStr: string | null = null;
  let inCom = false;
  let inUrl = false;
  const pad = () => "  ".repeat(indent);
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1] ?? "";
    if (inCom) {
      out += ch;
      if (ch === "*" && nx === "/") { out += "/"; i += 2; inCom = false; out += "\n" + pad(); continue; }
      i++; continue;
    }
    if (inStr) {
      out += ch;
      if (ch === "\\") { out += nx; i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === "/" && nx === "*") { inCom = true; out += "/*"; i += 2; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; out += ch; i++; continue; }
    if (ch === "(") {
      if (src.slice(Math.max(0, i - 3), i) === "url") inUrl = true;
      out += ch; i++; continue;
    }
    if (ch === ")") { inUrl = false; out += ch; i++; continue; }
    if (ch === "{") {
      out = out.replace(/[\s]+$/, "") + " {\n";
      indent++;
      out += pad();
      i++; continue;
    }
    if (ch === "}") {
      indent = Math.max(0, indent - 1);
      out = out.replace(/[\s]+$/, "") + "\n" + pad() + "}\n" + pad();
      i++; continue;
    }
    if (ch === ";") { out += ";\n" + pad(); i++; continue; }
    if (ch === ":") {
      if (inUrl || nx === "/") { out += ":"; i++; continue; }
      const inDecl = indent > 0;
      out += inDecl ? ": " : ":";
      i++;
      if (inDecl && src[i] === " ") i++;
      continue;
    }
    if (ch === ",") { out += ","; if (nx !== " " && nx !== "\n") out += " "; i++; continue; }
    if (ch === "\n" || ch === "\r") { i++; continue; }
    out += ch; i++;
  }
  return out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/^\s+/, "").replace(/\s+$/, "\n");
}

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
function profileQuery(): string {
  const parts: string[] = [];
  if (currentProfile !== "default") parts.push(`profile=${encodeURIComponent(currentProfile)}`);
  parts.push(`lang=${lang}`);
  return `?${parts.join("&")}`;
}
$("copyChatProfileBtn").addEventListener("click", (e) => {
  void copyText(`${base}/chat${profileQuery()}`, e.currentTarget as HTMLButtonElement);
});
$("copyGoalProfileBtn").addEventListener("click", (e) => {
  void copyText(`${base}/goal${profileQuery()}`, e.currentTarget as HTMLButtonElement);
});

$("cssSampleBtn").addEventListener("click", () => {
  const sample = `.msg {\n  border: 2px solid #22c55e;\n  font-weight: 700;\n}\n.msg .user {\n  font-size: 20px;\n}\n`;
  cssTa.value = cssTa.value ? cssTa.value + "\n" + sample : sample;
  afterCssEdit();
});
$("cssFormatBtn").addEventListener("click", () => {
  cssTa.value = formatCss(cssTa.value);
  afterCssEdit();
});
$("cssDocsBtn").addEventListener("click", () => {
  const docs = document.getElementById("cssDocs") as HTMLDivElement;
  docs.hidden = !docs.hidden;
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

// ---------- App settings: updater ----------
const autoUpdateChk = $<HTMLInputElement>("autoUpdateChk");
autoUpdateChk.checked = localStorage.getItem("rechat-auto-update") !== "0";
autoUpdateChk.addEventListener("change", () => {
  localStorage.setItem("rechat-auto-update", autoUpdateChk.checked ? "1" : "0");
});

// Built-in updater (M7 + M8.1 fix): check() only RETURNS the update —
// it never shows a dialog and never installs anything (the config
// option dialog:true only adds UI *during* installation). The M7 code
// dropped the returned Update object, so every available update was
// silently lost. Now: ask the user with the changelog notes, then
// downloadAndInstall (on Windows this exits the app and the installer
// restarts it, restart_after_install defaults to true).
async function runUpdateCheck(manual: boolean): Promise<void> {
  if (!isTauri) return;
  const status = $("updateStatus");
  const t = dict[lang];
  status.textContent = t.updateChecking;
  try {
    const update = await checkUpdate();
    if (!update) { status.textContent = t.updateLatest; return; }
    const notes = update.body ? "\n\n" + update.body : "";
    const ok = window.confirm(t.updateConfirm.replace("{v}", update.version) + notes);
    if (!ok) { status.textContent = ""; return; }
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") {
        total = (ev.data as { contentLength?: number }).contentLength ?? 0;
        status.textContent = t.updateDownloading;
      } else if (ev.event === "Progress") {
        done += (ev.data as { chunkLength: number }).chunkLength;
        status.textContent = total > 0
          ? `${t.updateDownloading} ${Math.round((done / total) * 100)}٪`
          : t.updateDownloading;
      } else if (ev.event === "Finished") {
        status.textContent = t.updateInstalled;
      }
    });
    status.textContent = t.updateInstalled;
  } catch (err) {
    status.textContent = manual ? `${t.updateFailed} (${String(err)})` : "";
  }
}
$("updateBtn").addEventListener("click", () => void runUpdateCheck(true));
$("quitBtn").addEventListener("click", () => {
  if (!isTauri) return;
  void invoke("quit_app").catch(() => undefined);
});
// Auto-check once at startup (silent unless an update dialog appears),
// unless the user turned it off in App settings.
if (autoUpdateChk.checked) void runUpdateCheck(false);

applyLang();
void loadBaseCss();
void reloadThemes();
