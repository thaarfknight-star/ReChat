// Goal overlay (M3: live Donofa goal, polled from the Rust server
// every 5s; the server itself polls Donofa every 10s.
// ?demo=1 keeps the sample goal for styling without a live link.)

const params = new URLSearchParams(location.search);
const demo = params.get("demo") === "1";
const profile = params.get("profile");
if (profile) document.body.dataset.profile = profile;
// Overlay language comes from the ?lang= param the settings window
// appends to the overlay link (M8 bilingual overlays).
const overlayLang = params.get("lang") === "en" ? "en" : "fa";
document.documentElement.lang = overlayLang;
document.documentElement.dir = overlayLang === "fa" ? "rtl" : "ltr";

const titleEl = document.querySelector("#goal .title") as HTMLDivElement;
const currentEl = document.getElementById("current") as HTMLSpanElement;
const targetEl = document.getElementById("target") as HTMLSpanElement;
const unitEl = document.getElementById("unit") as HTMLSpanElement;
const pctEl = document.getElementById("pct") as HTMLSpanElement;
const fill = document.getElementById("fill") as HTMLDivElement;
const errorEl = document.getElementById("goalError") as HTMLDivElement;

const fmt = new Intl.NumberFormat(overlayLang === "fa" ? "fa-IR" : "en-US");
// The server's unit labels are Persian (its Donofa map); translate the
// known ones for the English overlay instead of changing the API.
const unitMap: Record<string, string> = { "تومان": "Toman", "دلار": "USD", "یورو": "EUR" };
function unitLabel(label: string): string {
  return overlayLang === "en" ? (unitMap[label] ?? label) : label;
}

type GoalStatus = {
  state: string;
  detail?: string;
  goal?: {
    title: string;
    unit_label: string;
    current: number;
    total: number;
    pct: number;
  };
};

function render(s: GoalStatus): void {
  if (s.goal) {
    const g = s.goal;
    titleEl.textContent = g.title;
    currentEl.textContent = fmt.format(Math.round(g.current));
    targetEl.textContent = fmt.format(Math.round(g.total));
    unitEl.textContent = unitLabel(g.unit_label);
    pctEl.textContent = `${fmt.format(Math.round(g.pct))}${overlayLang === "fa" ? "٪" : "%"}`;
    fill.style.width = `${g.pct}%`;
  }
  if (s.state === "error") {
    errorEl.textContent = s.detail
      ? overlayLang === "fa" ? `خطا در به‌روزرسانی Goal: ${s.detail}` : `Goal update error: ${s.detail}`
      : overlayLang === "fa" ? "خطا در به‌روزرسانی Goal" : "Goal update error";
  } else if (s.state === "idle" || s.state === "loading") {
    if (!s.goal) {
      titleEl.textContent =
        s.state === "loading"
          ? overlayLang === "fa" ? "در حال خواندن Goal…" : "Reading goal…"
          : overlayLang === "fa" ? "Goal تنظیم نشده است" : "Goal not set";
    }
    errorEl.textContent = "";
  } else {
    errorEl.textContent = "";
  }
}

if (demo) {
  render({
    state: "live",
    goal: { title: overlayLang === "fa" ? "هدف فالوور" : "Follower goal", unit_label: "", current: 145, total: 300, pct: 48 },
  });
} else {
  async function refresh(): Promise<void> {
    // Hidden tab (inactive Meld scene): skip the fetch entirely.
    if (document.hidden) return;
    try {
      const r = await fetch("/api/goal");
      render((await r.json()) as GoalStatus);
    } catch {
      errorEl.textContent = overlayLang === "fa" ? "ارتباط با سرور محلی قطع شد" : "Local server connection lost";
    }
  }
  let timer = setInterval(() => void refresh(), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(timer);
    } else {
      void refresh();
      timer = setInterval(() => void refresh(), 5000);
    }
  });
  void refresh();
}

export {};
