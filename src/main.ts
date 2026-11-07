// ReChat settings UI (M2: live chat connect + filters via Tauri commands;
// M8: nav pages, fixed dual preview, accordion customization, presets,
// Kick OAuth auto-connect, separate app-settings page.
// Outside Tauri (plain browser dev) the buttons degrade to local save.)

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";

// ---------- M9 shared helpers: toast, pills, display settings ----------

const toastEl = document.getElementById("toast") as HTMLDivElement;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function setPill(el: HTMLElement, dot: "ok" | "warn" | "bad" | "idle", text: string): void {
  el.innerHTML = "";
  const d = document.createElement("span");
  d.className = `dot ${dot}`;
  const t = document.createElement("span");
  t.textContent = text;
  el.appendChild(d);
  el.appendChild(t);
}

// Display-only settings (localStorage; they ride the overlay link as query
// params so Meld's browser source sees them too — no backend change).
type DisplaySettings = { chatDir: string; goalDir: string; digits: string; goalUnit: string; goalUnitCustom: string };
function loadDisplay(): DisplaySettings {
  try {
    return {
      chatDir: "auto", goalDir: "auto", digits: "auto", goalUnit: "auto", goalUnitCustom: "",
      ...(JSON.parse(localStorage.getItem("rechat-display") ?? "{}") as Partial<DisplaySettings>),
    };
  } catch {
    return { chatDir: "auto", goalDir: "auto", digits: "auto", goalUnit: "auto", goalUnitCustom: "" };
  }
}
let display = loadDisplay();
function saveDisplay(): void {
  localStorage.setItem("rechat-display", JSON.stringify(display));
  refreshOverlayUrls();
  updatePreview();
}
function overlayParams(profile?: string): string {
  const parts: string[] = [];
  if (profile && profile !== "default") parts.push(`profile=${encodeURIComponent(profile)}`);
  parts.push(`lang=${lang}`);
  if (display.chatDir !== "auto") parts.push(`dir=${display.chatDir}`);
  if (display.goalDir !== "auto") parts.push(`goald=${display.goalDir}`);
  if (display.digits !== "auto") parts.push(`digits=${display.digits}`);
  if (display.goalUnit === "custom" && display.goalUnitCustom.trim()) {
    parts.push(`unit=${encodeURIComponent(display.goalUnitCustom.trim())}`);
  }
  return parts.join("&");
}
async function openInBrowser(url: string, btn?: HTMLButtonElement): Promise<void> {
  if (isTauri) {
    try {
      await openUrl(url);
      return;
    } catch {
      if (btn) showToast(dict[lang].openFailed);
      return;
    }
  }
  window.open(url, "_blank", "noopener");
}

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
    cssHint: "پیشنهاد هوشمند فقط با Ctrl+Space باز می‌شود؛ Tab دو فاصله می‌گذارد؛ براکت‌ها خودکار بسته می‌شوند.",
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
    chatLinkLabel: "چت",
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
    // ---- M9 ----
    connTitle: "اتصال کیک",
    connNote: "یک حالت را انتخاب کن؛ «نام کانال» ساده‌ترین حالت است، و اگر از ایران وصل می‌شوی و کیک مستقیم باز نمی‌شود، «مستراستریم» یا «تل‌لایو» را بزن.",
    modeChannel: "نام کانال (ساده)",
    modeOauth: "ورود با Kick (پیشنهادی)",
    modeMs: "مستراستریم (ایران)",
    msLinkLabel: "لینک ویجت چت مستراستریم",
    msNote: "لینک ویجت را از داشبورد مستراستریم کپی کن؛ ReChat فقط با masterstream.ir حرف می‌زند و پیام‌ها با همان قالب و فیلترهای خود ReChat نشان داده می‌شوند. لینک فقط روی همین سیستم می‌ماند.",
    msEmpty: "لینک ویجت مستراستریم را بنویس.",
    msInvalid: "لینک باید لینک ویجت مستراستریم باشد.",
    modeTl: "تل‌لایو (ایران)",
    tlLinkLabel: "لینک اورلی چت تل‌لایو",
    tlNote: "لینک اورلی چت را از داشبورد تل‌لایو کپی کن؛ پیام‌ها با همان قالب و فیلترهای خود ReChat نشان داده می‌شوند. لینک فقط روی همین سیستم می‌ماند.",
    tlEmpty: "لینک اورلی تل‌لایو را بنویس.",
    tlInvalid: "لینک باید لینک اورلی تل‌لایو باشد.",
    channelLabelNew: "نام کانال یا لینک کانال",
    channelHint: "پیام‌های زنده‌ی کانال در اورلی نمایش داده می‌شوند.",
    channelEmpty: "نام کانال را بنویس.",
    channelNotFound: "کانال پیدا نشد. املای نام کانال را چک کن.",
    channelNetwork: "به کیک وصل نشد؛ اینترنت را چک کن و دوباره بزن.",
    channelGeneric: "اتصال ناموفق بود؛ دوباره تلاش کن.",
    goalInvalid: "لینک درست نیست؛ لینک کامل Donofa را کپی کن.",
    goalNetwork: "Goal خوانده نشد؛ اینترنت را چک کن و دوباره ذخیره کن.",
    goalServer: "Donofa به این درخواست جواب نداد؛ کمی بعد با همان لینک دوباره امتحان کن.",
    goalGeneric: "Goal خوانده نشد؛ دوباره ذخیره کن.",
    kickAdvancedSummary: "پیشرفته: Client ID و Client Secret",
    kickAdvancedNote: "برای ورود با Kick باید یک بار در Kick برنامه بسازی و این دو مقدار را اینجا ذخیره کنی؛ فقط روی همین سیستم می‌مانند.",
    kickOauthConnected: "متصل به Kick",
    kickOauthNot: "وصل نیست. با «اتصال با Kick» وارد شو تا کانالت خودکار پیدا شود.",
    openLink: "باز کردن",
    testLink: "تست",
    openFailed: "مرورگر باز نشد؛ لینک را دستی کپی کن.",
    meldHintShort: "این لینک‌ها را در Meld به‌عنوان Browser Source اضافه کن. دکمه‌ی «تست» نسخه‌ی نمونه را در مرورگر باز می‌کند.",
    meldGuideBtn: "راهنمای افزودن به Meld ←",
    reset: "بازنشانی",
    resetConfirm: "همه‌ی تنظیم‌های این بخش به پیش‌فرض برگردد؟",
    resetDone: "به پیش‌فرض برگشت.",
    searchPlaceholder: "جست‌وجو در تنظیمات…",
    searchEmpty: "چیزی پیدا نشد.",
    testMsg: "پیام آزمایشی +",
    bgChecker: "شفاف",
    bgLight: "روشن",
    bgDark: "تیره",
    bgGame: "صحنه‌ی بازی",
    chatDirLabel: "جهت چت",
    dirAuto: "خودکار",
    dirRtl: "راست‌به‌چپ",
    dirLtr: "چپ‌به‌راست",
    goalDirLabel: "جهت نوار",
    goalDirAuto: "هم‌جهت با زبان",
    digitsLabel: "رقم‌ها",
    digitsAuto: "هم‌جهت با زبان",
    unitLabel: "واحد پول",
    unitAuto: "از Donofa",
    unitCustom: "دلخواه…",
    lineHeightLabel: "فاصله‌ی خطوط",
    msgPadLabel: "فاصله‌ی داخل پیام (px)",
    goalStatCurrent: "فعلی",
    goalStatTarget: "هدف",
    goalStatPct: "پیشرفت",
    wizTitle: "به ReChat خوش آمدی!",
    wizStep1Text: "در سه قدم آماده‌ی استریم شو. اول: نام کانال کیکت را بزن و وصل شو.",
    wizChannelLabel: "نام کانال کیک",
    wizConnect: "اتصال",
    wizSkip: "رد کردن",
    wizStep2Title: "لینک‌های اورلی را کپی کن",
    wizStep2Text: "این دو لینک را در Meld به‌عنوان Browser Source اضافه می‌کنی.",
    wizCopyChat: "کپی لینک چت",
    wizCopyGoal: "کپی لینک Goal",
    wizPrev: "قبلی",
    wizNext: "بعدی",
    wizStep3Title: "در Meld اضافه کن",
    wizStep3Text: "در Meld: پنل Layers ← + ← Browser، بعد لینک را در قسمت URL بچسبان. پس‌زمینه شفاف است و نیازی به Chroma Key نیست.",
    wizFinish: "تمام شد!",
    reopenOnboard: "نمایش راهنمای شروع",
    usersHint: "برای افزودن، نام را بنویس و Enter بزن؛ برای حذف، روی × بزن. فیلترها همان لحظه روی پیام‌های تازه اعمال می‌شوند.",
    versionNoteNew: "نسخه‌ی ۰٫۳٫۱۱",
    aboutTextNew: "نسخه‌ی ۰٫۳٫۱۱ (خطای Goal علت دقیق را می‌گوید و salt لینک دیگر روی اورلی دیده نمی‌شود + دو تلاش سریع برای قطعی‌های لحظه‌ای). چت و Goal کیک را می‌گیرد و به‌صورت اورلی شفاف به Meld می‌دهد. تنظیمات فقط روی همین سیستم می‌ماند.",
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
    cssHint: "Smart suggestions only on Ctrl+Space; Tab inserts two spaces; brackets auto-close.",
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
    chatLinkLabel: "Chat",
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
    // ---- M9 ----
    connTitle: "Kick connection",
    connNote: "Pick a mode; “Channel name” is the simplest, and if you connect from Iran and Kick does not open directly, pick “MasterStream” or “TeleLivee”.",
    modeChannel: "Channel name (simple)",
    modeOauth: "Sign in with Kick (recommended)",
    modeMs: "MasterStream (Iran)",
    msLinkLabel: "MasterStream chat widget link",
    msNote: "Copy the widget link from your MasterStream dashboard; ReChat talks only to masterstream.ir and messages arrive with ReChat's own theme and filters. The link stays on this machine only.",
    msEmpty: "Type the MasterStream widget link.",
    msInvalid: "That must be a MasterStream widget link.",
    modeTl: "TeleLivee (Iran)",
    tlLinkLabel: "TeleLivee chat overlay link",
    tlNote: "Copy the chat overlay link from your TeleLivee dashboard; messages arrive with ReChat's own theme and filters. The link stays on this machine only.",
    tlEmpty: "Type the TeleLivee overlay link.",
    tlInvalid: "That must be a TeleLivee overlay link.",
    channelLabelNew: "Channel name or channel link",
    channelHint: "Live channel messages show up in the overlay.",
    channelEmpty: "Type a channel name.",
    channelNotFound: "Channel not found. Check the spelling.",
    channelNetwork: "Could not reach Kick; check your connection and retry.",
    channelGeneric: "Connection failed; try again.",
    goalInvalid: "That link looks wrong; paste the full Donofa link.",
    goalNetwork: "Goal could not be read; check your connection and save again.",
    goalServer: "Donofa did not answer this request; try again shortly with the same link.",
    goalGeneric: "Goal could not be read; save again.",
    kickAdvancedSummary: "Advanced: Client ID and Client Secret",
    kickAdvancedNote: "To sign in with Kick, create an app in Kick once and save these two values here; they stay on this machine only.",
    kickOauthConnected: "Connected to Kick",
    kickOauthNot: "Not connected. Sign in with Kick so your channel is found automatically.",
    openLink: "Open",
    testLink: "Test",
    openFailed: "Browser did not open; copy the link manually.",
    meldHintShort: "Add these links in Meld as a Browser Source. “Test” opens a sample version in the browser.",
    meldGuideBtn: "How to add to Meld →",
    reset: "Reset",
    resetConfirm: "Reset this section to defaults?",
    resetDone: "Reset to defaults.",
    searchPlaceholder: "Search settings…",
    searchEmpty: "Nothing found.",
    testMsg: "Test message +",
    bgChecker: "Transparent",
    bgLight: "Light",
    bgDark: "Dark",
    bgGame: "Game scene",
    chatDirLabel: "Chat direction",
    dirAuto: "Auto",
    dirRtl: "Right-to-left",
    dirLtr: "Left-to-right",
    goalDirLabel: "Bar direction",
    goalDirAuto: "Follow language",
    digitsLabel: "Digits",
    digitsAuto: "Follow language",
    unitLabel: "Currency unit",
    unitAuto: "From Donofa",
    unitCustom: "Custom…",
    lineHeightLabel: "Line height",
    msgPadLabel: "Message padding (px)",
    goalStatCurrent: "Raised",
    goalStatTarget: "Target",
    goalStatPct: "Progress",
    wizTitle: "Welcome to ReChat!",
    wizStep1Text: "Get stream-ready in three steps. First: type your Kick channel name and connect.",
    wizChannelLabel: "Kick channel name",
    wizConnect: "Connect",
    wizSkip: "Skip",
    wizStep2Title: "Copy the overlay links",
    wizStep2Text: "You will add these two links in Meld as Browser Sources.",
    wizCopyChat: "Copy chat link",
    wizCopyGoal: "Copy goal link",
    wizPrev: "Back",
    wizNext: "Next",
    wizStep3Title: "Add it in Meld",
    wizStep3Text: "In Meld: Layers panel → + → Browser, then paste the link into the URL field. The background is transparent, no Chroma Key needed.",
    wizFinish: "Done!",
    reopenOnboard: "Show getting-started guide",
    usersHint: "Type a name and press Enter to add; click × to remove. Filters apply instantly to new messages.",
    versionNoteNew: "Version 0.3.11",
    aboutTextNew: "Version 0.3.11 (Goal errors now name the exact cause and the link salt no longer shows on the overlay + two quick retries for transient blips). Takes Kick chat and Goal and hands them to Meld as transparent overlays. Settings stay on this machine.",
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PORT = 17874;
const base = `http://localhost:${PORT}`;
const isTauri =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;

const channelInput = $<HTMLInputElement>("channelInput");
const msLinkInput = $<HTMLInputElement>("msLinkInput");
const tlLinkInput = $<HTMLInputElement>("tlLinkInput");
const goalInput = $<HTMLInputElement>("goalInput");
const langBtn = $<HTMLButtonElement>("langBtn");
const chatStatus = $("chatStatus");
const goalStatus = $("goalStatus");
const hideCmdChk = $<HTMLInputElement>("hideCmdChk");

let lang: Lang = (localStorage.getItem("rechat-lang") as Lang) || "fa";
channelInput.value = localStorage.getItem("rechat-channel") ?? "";
msLinkInput.value = localStorage.getItem("rechat-masterstream") ?? "";
tlLinkInput.value = localStorage.getItem("rechat-telelivee") ?? "";
goalInput.value = localStorage.getItem("rechat-goal") ?? "";

type Filters = {
  hide_commands: boolean;
  hidden_users: string[];
  hidden_words: string[];
  hidden_bots: string[];
};

// ---------- M9 chip inputs (replace the raw filter textareas) ----------

type ChipBox = { box: HTMLDivElement; input: HTMLInputElement; values: () => string[]; set: (v: string[]) => void };
function makeChips(boxId: string, inputId: string, onChange: () => void): ChipBox {
  const box = $<HTMLDivElement>(boxId);
  const input = $<HTMLInputElement>(inputId);
  const render = (values: string[]): void => {
    for (const chip of [...box.querySelectorAll(".chip")]) chip.remove();
    for (const v of values) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = v;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `remove ${v}`);
      x.addEventListener("click", () => {
        chip.remove();
        onChange();
      });
      chip.appendChild(x);
      box.insertBefore(chip, input);
    }
  };
  const values = (): string[] =>
    [...box.querySelectorAll(".chip")].map((c) => (c.firstChild?.textContent ?? "").trim()).filter(Boolean);
  const commit = (): void => {
    const v = input.value.trim();
    input.value = "";
    if (!v) return;
    const cur = values();
    if (!cur.includes(v)) cur.push(v);
    render(cur);
    onChange();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && input.value === "") {
      const chips = box.querySelectorAll(".chip");
      chips[chips.length - 1]?.remove();
      onChange();
    }
  });
  input.addEventListener("blur", commit);
  box.addEventListener("click", () => input.focus());
  return { box, input, values, set: render };
}

let chipsUsers: ChipBox;
let chipsBots: ChipBox;
let chipsWords: ChipBox;

function currentFilters(): Filters {
  return {
    hide_commands: hideCmdChk.checked,
    hidden_users: chipsUsers.values(),
    hidden_words: chipsWords.values(),
    hidden_bots: chipsBots.values(),
  };
}

function applyFiltersToUi(f: Filters): void {
  hideCmdChk.checked = f.hide_commands;
  chipsUsers.set(f.hidden_users);
  chipsWords.set(f.hidden_words);
  chipsBots.set(f.hidden_bots);
}

// Chip boxes must exist before the saved-filters restore below runs.
chipsUsers = makeChips("usersChips", "usersChipInput", scheduleFilterSave);
chipsBots = makeChips("botsChips", "botsChipInput", scheduleFilterSave);
chipsWords = makeChips("wordsChips", "wordsChipInput", scheduleFilterSave);

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

// One chat status, shown in the connection card AND the header pill.
// Backend detail strings are technical; map the common ones to a
// human-readable message with a suggested fix.
function humanChatError(detail?: string): string {
  const t = dict[lang];
  const d = (detail ?? "").toLowerCase();
  // MasterStream / TeleLivee backend details are already
  // human-readable Persian; show them as-is instead of the generic
  // Kick fallback.
  if (d.includes("ویجت") || d.includes("مستراستریم") || d.includes("masterstream") || d.includes("تل‌لایو") || d.includes("telelivee") || d.includes("اورلی")) return detail ?? "";
  if (d.includes("not found") || d.includes("404") || d.includes("no channel")) return t.channelNotFound;
  if (d.includes("network") || d.includes("fetch") || d.includes("timed out") || d.includes("econnrefused") || d.includes("dns")) return t.channelNetwork;
  return t.channelGeneric;
}
let lastChatState = "idle";
let lastChatChannel = "";
let lastChatDetail = "";
function renderStatus(state: string, channel?: string, detail?: string): void {
  lastChatState = state;
  lastChatChannel = channel ?? "";
  lastChatDetail = detail ?? "";
  const t = dict[lang];
  const channelError = $("channelError");
  let dot: "ok" | "warn" | "bad" | "idle" = "idle";
  let text = statusText(state, channel);
  if (state === "connected") {
    dot = "ok";
    channelError.textContent = "";
  } else if (state === "resolving" || state === "connecting" || state === "reconnecting") {
    dot = "warn";
    channelError.textContent = "";
  } else if (state === "error") {
    dot = "bad";
    text = statusText("error");
    channelError.textContent = humanChatError(detail);
  } else {
    channelError.textContent = "";
  }
  setPill(chatStatus, dot, text);
  const hdr = $("hdrKickStatus");
  const hdrText = state === "connected" ? `${t.connected}${channel ? ` (${channel})` : ""}` : text;
  setPill(hdr, dot, hdrText);
}

const chatUrl = $<HTMLInputElement>("chatUrl");
const goalUrl = $<HTMLInputElement>("goalUrl");

function refreshOverlayUrls(): void {
  chatUrl.value = `${base}/chat?${overlayParams()}`;
  goalUrl.value = `${base}/goal?${overlayParams()}`;
}

function applyLang(): void {
  const t = dict[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  ($("tagline").textContent = t.tagline);
  ($("navConnect").textContent = t.navConnect);
  ($("navCustomize").textContent = t.navCustomize);
  ($("navGuide").textContent = t.navGuide);
  ($("navSettings").textContent = t.navSettings);
  ($("connTitle").textContent = t.connTitle);
  ($("connNote").textContent = t.connNote);
  ($("modeChannelBtn").textContent = t.modeChannel);
  ($("modeOauthBtn").textContent = t.modeOauth);
  ($("modeMsBtn").textContent = t.modeMs);
  ($("msLinkLabel").textContent = t.msLinkLabel);
  ($("msNote").textContent = t.msNote);
  ($("msConnectBtn").textContent = t.connect);
  ($("msDisconnectBtn").textContent = t.disconnect);
  ($("modeTlBtn").textContent = t.modeTl);
  ($("tlLinkLabel").textContent = t.tlLinkLabel);
  ($("tlNote").textContent = t.tlNote);
  ($("tlConnectBtn").textContent = t.connect);
  ($("tlDisconnectBtn").textContent = t.disconnect);
  ($("kickAdvancedSummary").textContent = t.kickAdvancedSummary);
  ($("kickAdvancedNote").textContent = t.kickAdvancedNote);
  ($("kickClientIdLabel").textContent = t.kickClientIdLabel);
  ($("kickSecretLabel").textContent = t.kickSecretLabel);
  ($("kickSaveBtn").textContent = t.kickSave);
  ($("kickGuideSummary").textContent = t.kickGuideSummary);
  ($("kickGuideText").textContent = t.kickGuideText);
  ($("kickConnectBtn").textContent = t.kickConnect);
  ($("kickDisconnectBtn").textContent = t.kickDisconnect);
  ($("channelLabel").textContent = t.channelLabelNew);
  ($("connectBtn").textContent = t.connect);
  ($("disconnectBtn").textContent = t.disconnect);
  ($("chatNote").textContent = t.channelHint);
  ($("filtersTitle").textContent = t.filtersTitle);
  ($("hideCmdLabel").textContent = t.hideCmdLabel);
  ($("usersLabel").textContent = t.usersLabel);
  ($("botsLabel").textContent = t.botsLabel);
  ($("wordsLabel").textContent = t.wordsLabel);
  ($("filtersNote").textContent = t.usersHint);
  ($("resetFiltersBtn").textContent = t.reset);
  ($("resetChatBtn").textContent = t.reset);
  ($("resetGoalBtn").textContent = t.reset);
  ($("resetCssBtn").textContent = t.reset);
  ($("openChatBtn").textContent = t.openLink);
  ($("testChatBtn").textContent = t.testLink);
  ($("openGoalBtn").textContent = t.openLink);
  ($("testGoalBtn").textContent = t.testLink);
  ($("guideLinkBtn").textContent = t.meldGuideBtn);
  ($("testMsgBtn").textContent = t.testMsg);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".pv-toolbar button[data-bg]")) {
    b.textContent = b.dataset.bg === "" ? t.bgChecker : b.dataset.bg === "light" ? t.bgLight : b.dataset.bg === "dark" ? t.bgDark : t.bgGame;
  }
  ($("searchEmpty").textContent = t.searchEmpty);
  ($("settingsSearch") as HTMLInputElement).placeholder = t.searchPlaceholder;
  ($("wizTitle").textContent = t.wizTitle);
  ($("wizStep1Text").textContent = t.wizStep1Text);
  ($("wizChannelLabel").textContent = t.wizChannelLabel);
  ($("wizConnectBtn").textContent = t.wizConnect);
  ($("wizSkipBtn").textContent = t.wizSkip);
  ($("wizStep2Title").textContent = t.wizStep2Title);
  ($("wizStep2Text").textContent = t.wizStep2Text);
  ($("wizCopyChatBtn").textContent = t.wizCopyChat);
  ($("wizCopyGoalBtn").textContent = t.wizCopyGoal);
  ($("wizBack2Btn").textContent = t.wizPrev);
  ($("wizNext2Btn").textContent = t.wizNext);
  ($("wizSkip2Btn").textContent = t.wizSkip);
  ($("wizStep3Title").textContent = t.wizStep3Title);
  ($("wizStep3Text").textContent = t.wizStep3Text);
  ($("wizBack3Btn").textContent = t.wizPrev);
  ($("wizFinishBtn").textContent = t.wizFinish);
  ($("reopenOnboardBtn").textContent = t.reopenOnboard);
  // Inline field labels (fa text baked into the HTML) + select options.
  const setLabel = (inputId: string, text: string): void => {
    const lab = document.getElementById(inputId)?.closest("label");
    if (lab && lab.firstChild) lab.firstChild.textContent = text;
  };
  const setSwitchLabel = (inputId: string, text: string): void => {
    const lab = document.getElementById(inputId)?.closest("label");
    const span = lab?.querySelector("span:last-child");
    if (span) span.textContent = text;
  };
  const setOptions = (selId: string, texts: string[]): void => {
    const sel = document.getElementById(selId) as HTMLSelectElement | null;
    if (!sel) return;
    [...sel.options].forEach((o, i) => { if (texts[i]) o.textContent = texts[i]; });
  };
  if (lang === "en") {
    setLabel("thChatSize", "Font size (px)");
    setLabel("thChatOpacity", "Background opacity (0–1)");
    setLabel("thChatText", "Text color");
    setLabel("thChatRadius", "Corner radius (px)");
    setLabel("thChatGap", "Message gap (px)");
    setLabel("thMaxMsg", "Max messages on screen");
    setLabel("thLineHeight", "Line height");
    setLabel("thMsgPad", "Message padding (px)");
    setLabel("thChatDir", "Chat direction");
    setLabel("thGoalTitle", "Title size (px)");
    setLabel("thGoalH", "Bar height (px)");
    setLabel("thGoalC1", "Bar start color");
    setLabel("thGoalC2", "Bar end color");
    setLabel("thGoalDir", "Bar direction");
    setLabel("thDigits", "Digits");
    setLabel("thGoalUnit", "Currency unit");
    setLabel("thGoalUnitCustom", "Custom unit");
    setSwitchLabel("thBadges", "Show badges");
    setSwitchLabel("thUserColor", "Username color from Kick");
    setSwitchLabel("thGoalValues", "Show amounts");
    setOptions("thChatDir", [t.dirAuto, t.dirRtl, t.dirLtr]);
    setOptions("thGoalDir", [t.goalDirAuto, t.dirRtl, t.dirLtr]);
    setOptions("thDigits", [t.digitsAuto, "Persian (۱۲۳۴۵۶۷۸۹۰)", "English (1234567890)"]);
    setOptions("thGoalUnit", [t.unitAuto, t.unitCustom]);
  } else {
    setLabel("thChatSize", "اندازه‌ی قلم (px)");
    setLabel("thChatOpacity", "شفافیت پس‌زمینه (۰ تا ۱)");
    setLabel("thChatText", "رنگ متن");
    setLabel("thChatRadius", "گردی گوشه (px)");
    setLabel("thChatGap", "فاصله‌ی پیام‌ها (px)");
    setLabel("thMaxMsg", "بیشترین پیام روی صفحه");
    setLabel("thLineHeight", "فاصله‌ی خطوط");
    setLabel("thMsgPad", "فاصله‌ی داخل پیام (px)");
    setLabel("thChatDir", "جهت چت");
    setLabel("thGoalTitle", "اندازه‌ی تیتر (px)");
    setLabel("thGoalH", "ارتفاع نوار (px)");
    setLabel("thGoalC1", "رنگ شروع نوار");
    setLabel("thGoalC2", "رنگ پایان نوار");
    setLabel("thGoalDir", "جهت نوار");
    setLabel("thDigits", "رقم‌ها");
    setLabel("thGoalUnit", "واحد پول");
    setLabel("thGoalUnitCustom", "واحد دلخواه");
    setSwitchLabel("thBadges", "بج‌ها نشان داده شوند");
    setSwitchLabel("thUserColor", "رنگ نام کاربر از کیک بیاید");
    setSwitchLabel("thGoalValues", "مبلغ‌ها نشان داده شوند");
    setOptions("thChatDir", [t.dirAuto, t.dirRtl, t.dirLtr]);
    setOptions("thGoalDir", [t.goalDirAuto, t.dirRtl, t.dirLtr]);
    setOptions("thDigits", [t.digitsAuto, "فارسی (۱۲۳۴۵۶۷۸۹۰)", "انگلیسی (1234567890)"]);
    setOptions("thGoalUnit", [t.unitAuto, t.unitCustom]);
  }
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
  ($("overlayTitle").textContent = t.overlayTitle);
  ($("chatLinkLabel").textContent = t.chatLinkLabel);
  ($("goalNote").textContent = t.goalNote);
  ($("copyChatBtn").textContent = t.copyLink);
  ($("copyGoalBtn").textContent = t.copyLink);
  ($("overlayNote").textContent = t.meldHintShort);
  ($("settingsTitle").textContent = t.settingsTitle);
  ($("langLabel").textContent = t.langLabel);
  ($("autoUpdateLabel").textContent = t.autoUpdateLabel);
  ($("versionNote").textContent = t.versionNoteNew);
  ($("aboutTitle").textContent = t.aboutTitle);
  ($("aboutText").textContent = t.aboutTextNew);
  ($("aboutLicense").textContent = t.aboutLicense);
  ($("updateBtn").textContent = t.updateBtn);
  ($("trayNote").textContent = t.trayNote);
  ($("quitBtn").textContent = t.quitApp);
  channelInput.placeholder = lang === "fa" ? "kick.com/tahaa" : "kick.com/username";
  ($("wizChannel") as HTMLInputElement).placeholder = lang === "fa" ? "kick.com/tahaa" : "kick.com/username";
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
  // Re-render the status pills from the last known states: otherwise a
  // pill keeps the previous language's text until the next status event
  // (0.3.1: the header Goal pill stayed Persian after switching to English).
  renderStatus(lastChatState, lastChatChannel, lastChatDetail);
  renderGoalStatus(lastGoalState, lastGoalDetail);
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
    applySearch();
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

// ---------- M9 connection modes (channel = default, OAuth = tab) ----------
// M9.5 adds a third tab: MasterStream widget link (for Iran, where
// Kick itself is not directly reachable). 0.3.10 adds a fourth:
// TeleLivee overlay link, same idea, different service.
type ConnMode = "channel" | "oauth" | "masterstream" | "telelivee";
function setConnMode(mode: ConnMode): void {
  localStorage.setItem("rechat-conn-mode", mode);
  ($("pane-channel").hidden = mode !== "channel");
  ($("pane-oauth").hidden = mode !== "oauth");
  ($("pane-masterstream").hidden = mode !== "masterstream");
  ($("pane-telelivee").hidden = mode !== "telelivee");
  ($("modeChannelBtn").classList.toggle("active", mode === "channel"));
  ($("modeOauthBtn").classList.toggle("active", mode === "oauth"));
  ($("modeMsBtn").classList.toggle("active", mode === "masterstream"));
  ($("modeTlBtn").classList.toggle("active", mode === "telelivee"));
}
$("modeChannelBtn").addEventListener("click", () => setConnMode("channel"));
$("modeOauthBtn").addEventListener("click", () => setConnMode("oauth"));
$("modeMsBtn").addEventListener("click", () => setConnMode("masterstream"));
$("modeTlBtn").addEventListener("click", () => setConnMode("telelivee"));
setConnMode((localStorage.getItem("rechat-conn-mode") as ConnMode) || "channel");

// ---------- M9.5 MasterStream connect ----------
$("msConnectBtn").addEventListener("click", () => {
  const link = msLinkInput.value.trim();
  localStorage.setItem("rechat-masterstream", link);
  if (!link) {
    msLinkInput.classList.add("invalid");
    ($("msError").textContent = dict[lang].msEmpty);
    return;
  }
  // 0.3.10: mstream.ir is MasterStream's short domain — same widget.
  if (!link.includes("masterstream.ir") && !link.includes("mstream.ir")) {
    msLinkInput.classList.add("invalid");
    ($("msError").textContent = dict[lang].msInvalid);
    return;
  }
  msLinkInput.classList.remove("invalid");
  ($("msError").textContent = "");
  localStorage.setItem("rechat-auto-chat", "masterstream");
  if (isTauri) {
    void invoke("connect_masterstream", { link }).catch(() => {
      renderStatus("error", "MasterStream", "network error");
    });
    renderStatus("resolving", "MasterStream");
  } else {
    renderStatus("idle");
    showToast(dict[lang].saved);
  }
});
$("msDisconnectBtn").addEventListener("click", () => {
  localStorage.removeItem("rechat-auto-chat");
  if (isTauri) void invoke("disconnect_chat").catch(() => undefined);
  renderStatus("idle");
});

// ---------- 0.3.10 TeleLivee connect ----------
$("tlConnectBtn").addEventListener("click", () => {
  const link = tlLinkInput.value.trim();
  localStorage.setItem("rechat-telelivee", link);
  if (!link) {
    tlLinkInput.classList.add("invalid");
    ($("tlError").textContent = dict[lang].tlEmpty);
    return;
  }
  if (!link.includes("telelivee.ir")) {
    tlLinkInput.classList.add("invalid");
    ($("tlError").textContent = dict[lang].tlInvalid);
    return;
  }
  tlLinkInput.classList.remove("invalid");
  ($("tlError").textContent = "");
  localStorage.setItem("rechat-auto-chat", "telelivee");
  if (isTauri) {
    void invoke("connect_telelivee", { link }).catch(() => {
      renderStatus("error", "TeleLivee", "network error");
    });
    renderStatus("resolving", "TeleLivee");
  } else {
    renderStatus("idle");
    showToast(dict[lang].saved);
  }
});
$("tlDisconnectBtn").addEventListener("click", () => {
  localStorage.removeItem("rechat-auto-chat");
  if (isTauri) void invoke("disconnect_chat").catch(() => undefined);
  renderStatus("idle");
});

// ---------- Manual chat connect (fallback) ----------
$("connectBtn").addEventListener("click", () => {
  const channel = channelInput.value.trim();
  localStorage.setItem("rechat-channel", channel);
  if (!channel) {
    channelInput.classList.add("invalid");
    ($("channelError").textContent = dict[lang].channelEmpty);
    return;
  }
  channelInput.classList.remove("invalid");
  ($("channelError").textContent = "");
  localStorage.setItem("rechat-auto-chat", "1");
  if (isTauri) {
    void invoke("connect_chat", { channel }).catch(() => {
      renderStatus("error", channel, "network error");
    });
    renderStatus("resolving", channel);
  } else {
    renderStatus("idle");
    showToast(dict[lang].saved);
  }
});
$("disconnectBtn").addEventListener("click", () => {
  localStorage.removeItem("rechat-auto-chat");
  if (isTauri) void invoke("disconnect_chat").catch(() => undefined);
  renderStatus("idle");
});

let lastGoalState = "idle";
let lastGoalDetail = "";
function humanGoalError(detail?: string): string {
  const t = dict[lang];
  const d = (detail ?? "").toLowerCase();
  // 0.3.11: the backend's classified details are already human
  // Persian (DNS / timeout / refused / TLS) — show them as-is
  // instead of the generic network bucket.
  if (
    d.includes("(dns)") ||
    d.includes("(تایم‌اوت)") ||
    d.includes("رد شد") ||
    d.includes("اتصال امن")
  ) {
    return detail ?? "";
  }
  if (
    d.includes("invalid") ||
    d.includes("parse") ||
    d.includes("not a donofa") ||
    d.includes("404") ||
    d.includes("لینک goal معتبر نیست") ||
    d.includes("goal فعالی نیست")
  ) {
    return t.goalInvalid;
  }
  if (d.includes("دونوفا جواب نداد")) return t.goalServer;
  if (
    d.includes("network") ||
    d.includes("fetch") ||
    d.includes("timed out") ||
    d.includes("timeout") ||
    d.includes("error sending request") ||
    d.includes("decoding") ||
    d.includes("dns") ||
    d.includes("connect") ||
    d.includes("refused") ||
    d.includes("reset") ||
    d.includes("certificate") ||
    d.includes("ssl") ||
    d.includes("handshake")
  ) {
    return t.goalNetwork;
  }
  return t.goalGeneric;
}
function renderGoalStatus(state: string, detail?: string): void {
  lastGoalState = state;
  lastGoalDetail = detail ?? "";
  const t = dict[lang];
  let s: string;
  let dot: "ok" | "warn" | "bad" | "idle" = "idle";
  switch (state) {
    case "live":
      s = t.goalLive;
      dot = "ok";
      break;
    case "loading":
      s = t.goalLoading;
      dot = "warn";
      break;
    case "error":
      s = t.goalError;
      dot = "bad";
      break;
    default:
      s = t.goalUnset;
  }
  setPill(goalStatus, dot, s);
  setPill($("hdrGoalStatus"), dot, s);
  const errEl = $("goalErrorText");
  const detailEl = $("goalErrorDetail");
  if (state === "error") {
    // 0.3.2: the old mapping sent every backend failure to the generic
    // "save again" text, hiding whether the link, the network, or Donofa
    // itself was at fault. reqwest error strings carry none of the old
    // keywords for DNS/connect/reset/TLS failures, so they all landed in
    // the generic bucket and told the user to re-save a good link.
    errEl.textContent = humanGoalError(detail);
    // 0.3.7: also show the raw backend detail (salt masked), so the
    // real cause is visible instead of only the generic message.
    detailEl.textContent = (detail ?? "").replace(/salt=[^&\s]+/gi, "salt=…");
  } else {
    errEl.textContent = "";
    detailEl.textContent = "";
  }
}

$("goalSaveBtn").addEventListener("click", () => {
  const link = goalInput.value.trim();
  localStorage.setItem("rechat-goal", link);
  if (!link) {
    renderGoalStatus("idle");
    return;
  }
  // Inline validation with a human-readable fix, before any backend call.
  if (!/^https?:\/\//i.test(link) || !link.includes("donofa")) {
    goalInput.classList.add("invalid");
    renderGoalStatus("error", "invalid link");
    return;
  }
  goalInput.classList.remove("invalid");
  if (isTauri) {
    void invoke("connect_goal", { link }).catch(() => {
      renderGoalStatus("error", "network error");
    });
    renderGoalStatus("loading");
  } else {
    showToast(dict[lang].saved);
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
hideCmdChk.addEventListener("input", scheduleFilterSave);
hideCmdChk.addEventListener("change", scheduleFilterSave);

async function copy(input: HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  const prev = btn.textContent;
  btn.textContent = dict[lang].copied;
  showToast(dict[lang].copied);
  setTimeout(() => (btn.textContent = prev), 1500);
}
$("copyChatBtn").addEventListener("click", (e) => void copy(chatUrl, e.currentTarget as HTMLButtonElement));
$("copyGoalBtn").addEventListener("click", (e) => void copy(goalUrl, e.currentTarget as HTMLButtonElement));
$("openChatBtn").addEventListener("click", (e) => void openInBrowser(chatUrl.value, e.currentTarget as HTMLButtonElement));
$("openGoalBtn").addEventListener("click", (e) => void openInBrowser(goalUrl.value, e.currentTarget as HTMLButtonElement));
$("testChatBtn").addEventListener("click", (e) => void openInBrowser(`${chatUrl.value}&demo=1`, e.currentTarget as HTMLButtonElement));
$("testGoalBtn").addEventListener("click", (e) => void openInBrowser(`${goalUrl.value}&demo=1`, e.currentTarget as HTMLButtonElement));
$("guideLinkBtn").addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>('#mainNav button[data-page="guide"]')?.click();
});

// ---------- M9 preview toolbar: backgrounds + test message ----------
for (const b of document.querySelectorAll<HTMLButtonElement>(".pv-toolbar button[data-bg]")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll<HTMLButtonElement>(".pv-toolbar button[data-bg]")) {
      x.classList.toggle("active", x === b);
    }
    const bg = b.dataset.bg ?? "";
    for (const frame of [previewChatFrame, previewGoalFrame]) {
      frame.classList.remove("pv-bg-light", "pv-bg-dark", "pv-bg-game");
      if (bg) frame.classList.add(`pv-bg-${bg}`);
    }
  });
}
$("testMsgBtn").addEventListener("click", () => {
  const pool = lang === "fa" ? TEST_SAMPLES_FA : TEST_SAMPLES_EN;
  previewExtra.push(pool[Math.floor(Math.random() * pool.length)]);
  updatePreview();
  showToast(dict[lang].testMsg);
});

// ---------- Kick OAuth auto-connect ----------
type KickOauthState = {
  client_id: string;
  has_secret: boolean;
  connected: boolean;
  username?: string;
  slug?: string;
};

const kickClientId = $<HTMLInputElement>("kickClientId");
const kickSecret = $<HTMLInputElement>("kickSecret");
const kickSavedNote = $("kickSavedNote");
const kickOauthState = $("kickOauthState");

function renderKick(s: KickOauthState): void {
  const t = dict[lang];
  kickClientId.value = s.client_id;
  if (s.connected) {
    kickOauthState.textContent = `${t.kickOauthConnected} (${s.username ?? s.slug ?? ""})`;
  } else {
    kickOauthState.textContent = t.kickOauthNot;
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
      kickOauthState.textContent = dict[lang].kickWaiting;
      let tries = 0;
      clearInterval(kickPollTimer);
      kickPollTimer = setInterval(() => {
        tries += 1;
        void refreshKickUi().then((s) => {
          if (s?.connected || tries >= 60) {
            clearInterval(kickPollTimer);
            if (s?.connected) {
              // 0.3.8: remember that Kick login is the chosen mode,
              // so startup auto-connect keeps it (and MasterStream
              // can still override it when chosen later).
              localStorage.setItem("rechat-auto-chat", "oauth");
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
      kickOauthState.textContent = dict[lang].kickNeedConfig;
    });
});
$("kickDisconnectBtn").addEventListener("click", () => {
  if (!isTauri) return;
  clearInterval(kickPollTimer);
  if (localStorage.getItem("rechat-auto-chat") === "oauth") {
    localStorage.removeItem("rechat-auto-chat");
  }
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
  // 0.3.7: the saved goal link was never reconnected on startup, so
  // after every restart the goal looked "not saved" until Save was
  // clicked again. Reconnect it now, like the remembered chat channel.
  const savedGoal = (localStorage.getItem("rechat-goal") ?? "").trim();
  if (savedGoal) {
    void invoke("connect_goal", { link: savedGoal }).catch(() => undefined);
  }
  // Auto-connect (0.3.8): honour the remembered mode first. Before
  // this, saved Kick tokens always won, so a user who had chosen
  // MasterStream still got the direct-Kick attempt on every startup
  // — unreachable from Iran — and MasterStream was never tried.
  void refreshKickUi().then((s) => {
    if (localStorage.getItem("rechat-auto-chat") === "masterstream" && msLinkInput.value.trim()) {
      void invoke("connect_masterstream", { link: msLinkInput.value.trim() }).catch(() => undefined);
    } else if (localStorage.getItem("rechat-auto-chat") === "telelivee" && tlLinkInput.value.trim()) {
      void invoke("connect_telelivee", { link: tlLinkInput.value.trim() }).catch(() => undefined);
    } else if (s?.connected) {
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
  chat_line_height: number;
  chat_msg_padding: number;
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
    chat_line_height: 1.7,
    chat_msg_padding: 10,
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
  let css = `:root{--chat-font-size:${t.chat_font_size}px;--chat-bg-opacity:${t.chat_bg_opacity};--chat-text:${t.chat_text_color};--chat-radius:${t.chat_radius}px;--chat-gap:${t.chat_gap}px;--chat-line-height:${t.chat_line_height};--chat-msg-padding:${t.chat_msg_padding}px;--goal-title-size:${t.goal_title_size}px;--goal-bar-h:${t.goal_bar_height}px;--goal-c1:${t.goal_bar_c1};--goal-c2:${t.goal_bar_c2};}`;
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
    chat_line_height: num($<HTMLInputElement>("thLineHeight"), 1.7),
    chat_msg_padding: num($<HTMLInputElement>("thMsgPad"), 10),
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
  $<HTMLInputElement>("thLineHeight").value = String(t.chat_line_height ?? 1.7);
  $<HTMLInputElement>("thMsgPad").value = String(t.chat_msg_padding ?? 10);
  $<HTMLInputElement>("thBadges").checked = t.show_badges;
  $<HTMLInputElement>("thUserColor").checked = t.show_username_color;
  $<HTMLInputElement>("thMaxMsg").value = String(t.max_messages);
  $<HTMLInputElement>("thGoalTitle").value = String(t.goal_title_size);
  $<HTMLInputElement>("thGoalC1").value = t.goal_bar_c1;
  $<HTMLInputElement>("thGoalC2").value = t.goal_bar_c2;
  $<HTMLInputElement>("thGoalH").value = String(t.goal_bar_height);
  $<HTMLInputElement>("thGoalValues").checked = t.show_goal_values;
  cssTa.value = t.custom_css;
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

// Extra preview messages added with the "Test message" button.
let previewExtra: string[] = [];
const TEST_SAMPLES_FA = [
  "سلام! امشب چه بازی‌ای می‌ریم؟",
  "این باس خیلی سخته، ولی great fight!",
  "دمت گرم، استریم عالی بود 🔥",
];
const TEST_SAMPLES_EN = [
  "Hey! What are we playing tonight?",
  "That boss fight was insane 🔥",
  "Great stream, loved the soulslike run!",
];

function previewDoc(kind: "chat" | "goal"): string {
  const css = buildThemeCss(themeFromControls());
  const head = `<meta charset="utf-8"><style>${baseOverlayCss}</style><style>${css}</style>`;
  const t = dict[lang];
  const pageDir = (d: string): string => (d === "rtl" ? "rtl" : d === "ltr" ? "ltr" : lang === "fa" ? "rtl" : "ltr");
  if (kind === "chat") {
    const dir = pageDir(display.chatDir);
    const msgDir = display.chatDir === "rtl" || display.chatDir === "ltr" ? display.chatDir : "auto";
    const mod = lang === "fa" ? "مدیر" : "Mod";
    const fa = lang === "fa";
    const emoteSvg = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#4ade80"/><circle cx="11" cy="13" r="2" fill="#04160a"/><circle cx="21" cy="13" r="2" fill="#04160a"/><path d="M10 20 Q16 26 22 20" stroke="#04160a" stroke-width="2" fill="none"/></svg>`);
    const samples = fa
      ? [
          `<div class="msg" dir="${msgDir}"><bdi><span class="badge moderator">${mod}</span><span class="user" style="color:#4ade80">tahaa</span></bdi>: سلام به همه! بازی امشب سولزلایک است</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#58a6ff">soul_fan</span></bdi>: <bdi dir="ltr">this boss fight is insane 🔥</bdi></div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="badge vip">VIP</span><span class="user" style="color:#f472b6">nightowl</span></bdi>: چت فارسی و انگلیسی قاطی هم خوب درمیاد، <bdi dir="ltr">great stream!</bdi></div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#a78bfa">long_reader</span></bdi>: این یک پیام طولانی است برای اینکه ببینیم متن بلند چندخطی چطور می‌شکند و فاصله‌ی خطوط و داخل پیام چقدر خواناست، مخصوصاً وقتی وسطش یک عبارت انگلیسی مثل <bdi dir="ltr">boss fight</bdi> هم باشد و آخرش علامت تعجب!</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#fbbf24">emote_king</span></bdi>: این ایموت‌ها چطور دیده می‌شوند؟ <img class="emote" src="${emoteSvg}" alt="KEKW" /> <img class="emote" src="${emoteSvg}" alt="Pog" /></div>`,
        ]
      : [
          `<div class="msg" dir="${msgDir}"><bdi><span class="badge moderator">${mod}</span><span class="user" style="color:#4ade80">tahaa</span></bdi>: Hey everyone! Tonight we play a soulslike</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#58a6ff">soul_fan</span></bdi>: this boss fight is insane 🔥</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="badge vip">VIP</span><span class="user" style="color:#f472b6">nightowl</span></bdi>: Persian and English chat mix nicely, great stream!</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#a78bfa">long_reader</span></bdi>: This is a long message to check how multi-line text wraps, how line height and padding read, especially with a Persian phrase in the middle like سلام به همه and an exclamation mark at the end!</div>`,
          `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#fbbf24">emote_king</span></bdi>: How do these emotes look? <img class="emote" src="${emoteSvg}" alt="KEKW" /> <img class="emote" src="${emoteSvg}" alt="Pog" /></div>`,
        ];
    const extra = previewExtra.map((m) => `<div class="msg" dir="${msgDir}"><bdi><span class="user" style="color:#4ade80">test_user</span></bdi>: ${m}</div>`).join("");
    return `<!doctype html><html dir="${dir}"><head>${head}</head><body><div id="pinned"><div class="msg" dir="${msgDir}"><bdi><span class="badge moderator">${mod}</span><span class="user" style="color:#4ade80">tahaa</span></bdi>: ${fa ? "این پیام پین‌شده است" : "This message is pinned"}</div></div><div id="messages">${samples.join("")}${extra}</div></body></html>`;
  }
  const dir = pageDir(display.goalDir);
  const digitsLocale = display.digits === "fa" ? "fa-IR" : display.digits === "en" ? "en-US" : lang === "fa" ? "fa-IR" : "en-US";
  const fmt = new Intl.NumberFormat(digitsLocale);
  const unit = display.goalUnit === "custom" && display.goalUnitCustom.trim()
    ? display.goalUnitCustom.trim()
    : lang === "fa" ? "تومان" : "Toman";
  const pctSign = lang === "fa" ? "٪" : "%";
  return `<!doctype html><html dir="${dir}"><head>${head}</head><body><div id="goal"><div class="title">${lang === "fa" ? "ارتقا استریم" : "Stream upgrade"}</div><div class="stats"><div class="stat cur"><span class="lbl">${t.goalStatCurrent}</span><span class="val"><span>${fmt.format(12500000)}</span> <span>${unit}</span></span></div><div class="stat tgt"><span class="lbl">${t.goalStatTarget}</span><span class="val"><span>${fmt.format(30000000)}</span> <span>${unit}</span></span></div><div class="stat pct"><span class="lbl">${t.goalStatPct}</span><span class="val">${fmt.format(42)}${pctSign}</span></div></div><div class="bar"><div class="fill" style="width:42%"></div></div><div id="goalError"></div></div></body></html>`;
}

function updatePreview(): void {
  previewChatFrame.srcdoc = previewDoc("chat");
  previewGoalFrame.srcdoc = previewDoc("goal");
}

const cssAcPopup = document.getElementById("cssAcPopup") as HTMLDivElement;

// 0.3.6: the old overlay editor reloaded both preview iframes on every
// keystroke, which can steal focus from the textarea in WebView2, and
// its autocomplete popped up on every typed word. Preview now updates
// debounced, autocomplete only on Ctrl+Space, and if an iframe reload
// did steal focus, it is handed back to the editor with the caret kept.
let cssPreviewTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleCssPreview(): void {
  clearTimeout(cssPreviewTimer);
  cssPreviewTimer = setTimeout(() => {
    const wasFocused = document.activeElement === cssTa;
    const s = cssTa.selectionStart;
    const en = cssTa.selectionEnd;
    updatePreview();
    const restore = (): void => {
      if (wasFocused && document.activeElement !== cssTa) {
        cssTa.focus();
        try {
          cssTa.selectionStart = s;
          cssTa.selectionEnd = en;
        } catch {
          /* keep focus even if the caret range is stale */
        }
      }
    };
    restore();
    setTimeout(restore, 150);
  }, 300);
}

function afterCssEdit(): void {
  scheduleCssPreview();
  scheduleThemeSave();
}

cssTa.addEventListener("input", () => {
  afterCssEdit();
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
  // 0.3.6: auto-close only brackets, never quotes — quote auto-close
  // kept inserting a second quote while typing strings and felt broken.
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  if (!e.ctrlKey && !e.metaKey && pairs[e.key]) {
    const s = cssTa.selectionStart;
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
    showSaved();
    return;
  }
  showSaved();
  clearTimeout(themeSaveTimer);
  themeSaveTimer = setTimeout(() => {
    void invoke("save_theme", { profile: currentProfile, theme }).catch(() => undefined);
  }, 500);
}

for (const id of [
  "thChatSize", "thChatOpacity", "thChatText", "thChatRadius", "thChatGap",
  "thLineHeight", "thMsgPad",
  "thBadges", "thUserColor", "thMaxMsg", "thGoalTitle", "thGoalC1",
  "thGoalC2", "thGoalH", "thGoalValues",
]) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener("input", () => {
    updatePreview();
    scheduleThemeSave();
  });
}

// ---------- M9: save indicator ----------
let saveIndTimer: ReturnType<typeof setTimeout> | undefined;
function showSaved(): void {
  const el = $("saveIndicator");
  el.textContent = dict[lang].saved;
  clearTimeout(saveIndTimer);
  saveIndTimer = setTimeout(() => (el.textContent = ""), 2000);
}

// ---------- M9: per-section reset (with confirmation) ----------
function confirmReset(): boolean {
  return window.confirm(dict[lang].resetConfirm);
}
$("resetFiltersBtn").addEventListener("click", () => {
  if (!confirmReset()) return;
  applyFiltersToUi({ hide_commands: false, hidden_users: [], hidden_words: [], hidden_bots: [] });
  scheduleFilterSave();
  showToast(dict[lang].resetDone);
});
$("resetChatBtn").addEventListener("click", () => {
  if (!confirmReset()) return;
  const d = defaultTheme();
  const cur = themeFromControls();
  loadThemeIntoControls({
    ...cur,
    chat_font_size: d.chat_font_size, chat_bg_opacity: d.chat_bg_opacity,
    chat_text_color: d.chat_text_color, chat_radius: d.chat_radius,
    chat_gap: d.chat_gap, chat_line_height: d.chat_line_height,
    chat_msg_padding: d.chat_msg_padding, show_badges: d.show_badges,
    show_username_color: d.show_username_color, max_messages: d.max_messages,
  });
  updatePreview();
  scheduleThemeSave();
  showToast(dict[lang].resetDone);
});
$("resetGoalBtn").addEventListener("click", () => {
  if (!confirmReset()) return;
  const d = defaultTheme();
  const cur = themeFromControls();
  loadThemeIntoControls({
    ...cur,
    goal_title_size: d.goal_title_size, goal_bar_c1: d.goal_bar_c1,
    goal_bar_c2: d.goal_bar_c2, goal_bar_height: d.goal_bar_height,
    show_goal_values: d.show_goal_values,
  });
  updatePreview();
  scheduleThemeSave();
  showToast(dict[lang].resetDone);
});
$("resetCssBtn").addEventListener("click", () => {
  if (!confirmReset()) return;
  cssTa.value = "";
  afterCssEdit();
  showToast(dict[lang].resetDone);
});

// ---------- M9: settings search (filters cards on the active page) ----------
function applySearch(): void {
  const q = ($("settingsSearch") as HTMLInputElement).value.trim().toLowerCase();
  const active = document.querySelector<HTMLElement>(".page:not([hidden])");
  if (!active) return;
  let visible = 0;
  for (const card of active.querySelectorAll<HTMLElement>(".card")) {
    const match = !q || (card.textContent ?? "").toLowerCase().includes(q);
    card.style.display = match ? "" : "none";
    if (match) visible++;
  }
  ($("searchEmpty").classList.toggle("show", q !== "" && visible === 0));
}
$("settingsSearch").addEventListener("input", applySearch);

// ---------- M9: first-run onboarding wizard ----------
const onboardBackdrop = $("onboardBackdrop");
function showWizard(step: number): void {
  for (const s of document.querySelectorAll<HTMLElement>(".wizard-step")) {
    s.hidden = Number(s.dataset.step) !== step;
  }
  for (const d of document.querySelectorAll<HTMLElement>(".wizard-dots span")) {
    d.classList.toggle("on", Number(d.dataset.dot) === step);
  }
  onboardBackdrop.hidden = false;
}
function closeWizard(): void {
  onboardBackdrop.hidden = true;
  localStorage.setItem("rechat-onboarded", "1");
}
$("wizConnectBtn").addEventListener("click", () => {
  const wizChannel = $<HTMLInputElement>("wizChannel");
  const v = wizChannel.value.trim();
  if (!v) {
    wizChannel.classList.add("invalid");
    return;
  }
  wizChannel.classList.remove("invalid");
  channelInput.value = v;
  ($("connectBtn") as HTMLButtonElement).click();
  showWizard(2);
});
$("wizSkipBtn").addEventListener("click", closeWizard);
$("wizSkip2Btn").addEventListener("click", closeWizard);
$("wizBack2Btn").addEventListener("click", () => showWizard(1));
$("wizNext2Btn").addEventListener("click", () => showWizard(3));
$("wizBack3Btn").addEventListener("click", () => showWizard(2));
$("wizFinishBtn").addEventListener("click", closeWizard);
$("wizCopyChatBtn").addEventListener("click", (e) => void copyText(chatUrl.value, e.currentTarget as HTMLButtonElement));
$("wizCopyGoalBtn").addEventListener("click", (e) => void copyText(goalUrl.value, e.currentTarget as HTMLButtonElement));
$("reopenOnboardBtn").addEventListener("click", () => showWizard(1));

// ---------- M9: display settings controls ----------
function loadDisplayIntoControls(): void {
  ($("thChatDir") as HTMLSelectElement).value = display.chatDir;
  ($("thGoalDir") as HTMLSelectElement).value = display.goalDir;
  ($("thDigits") as HTMLSelectElement).value = display.digits;
  ($("thGoalUnit") as HTMLSelectElement).value = display.goalUnit;
  ($("thGoalUnitCustom") as HTMLInputElement).value = display.goalUnitCustom;
  const customLab = ($("thGoalUnitCustom") as HTMLInputElement).closest("label");
  if (customLab) (customLab as HTMLElement).style.display = display.goalUnit === "custom" ? "" : "none";
}
($("thChatDir") as HTMLSelectElement).addEventListener("change", (e) => {
  display.chatDir = (e.currentTarget as HTMLSelectElement).value;
  saveDisplay();
});
($("thGoalDir") as HTMLSelectElement).addEventListener("change", (e) => {
  display.goalDir = (e.currentTarget as HTMLSelectElement).value;
  saveDisplay();
});
($("thDigits") as HTMLSelectElement).addEventListener("change", (e) => {
  display.digits = (e.currentTarget as HTMLSelectElement).value;
  saveDisplay();
});
($("thGoalUnit") as HTMLSelectElement).addEventListener("change", (e) => {
  display.goalUnit = (e.currentTarget as HTMLSelectElement).value;
  const customLab = ($("thGoalUnitCustom") as HTMLInputElement).closest("label");
  if (customLab) (customLab as HTMLElement).style.display = display.goalUnit === "custom" ? "" : "none";
  saveDisplay();
});
($("thGoalUnitCustom") as HTMLInputElement).addEventListener("input", (e) => {
  display.goalUnitCustom = (e.currentTarget as HTMLInputElement).value;
  saveDisplay();
});

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
  return `?${overlayParams(currentProfile)}`;
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
loadDisplayIntoControls();
void loadBaseCss();
void reloadThemes();
if (!localStorage.getItem("rechat-onboarded")) showWizard(1);
