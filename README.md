# ReChat — اورلی چت و Goal کیک برای Meld Studio

ReChat چت زنده‌ی کیک و Goal دونوفا را می‌گیرد و به‌صورت اورلی شفاف
به Meld Studio می‌دهد. بدون لاگین؛ تنظیمات فقط روی همین سیستم می‌ماند.

## امکانات (تا M5)

- **چت زنده‌ی کیک** با Pusher (همان مسیری که سایت کیک استفاده می‌کند):
  رنگ نام کاربر، بج‌ها، ایموت‌ها، پیام پین‌شده، حذف پیام، اتصال دوباره‌ی
  خودکار و وضعیت اتصال
- **Goal زنده‌ی Donofa** با پولینگ هر ۱۰ ثانیه (بدون لاگین)
- **شخصی‌سازی کامل + پروفایل هر صحنه** با لینک اورلی خودش
  (`/chat?profile=…` و `/goal?profile=…`)، ویرایشگر CSS با هایلایت و
  پیش‌نمایش زنده
- **راهنمای Meld داخل برنامه** + اورلی‌های کاملاً شفاف (بدون Chroma Key)

## اجرا (ویندوز)

```sh
npm install
npm run tauri dev
```

لینک‌های اورلی (وقتی برنامه در حال اجراست):

- چت: `http://localhost:17874/chat`
- Goal: `http://localhost:17874/goal`

## لایسنس — License

ReChat دوگانه‌لایسنس است: **MIT یا Apache-2.0، به انتخاب شما**
(فایل‌های `LICENSE`، `LICENSE-MIT`، `LICENSE-APACHE` و `COPYRIGHT`).
کپی‌رایت © 2026 Taha Arefi.

وابستگی‌های شخص ثالث و لایسنس هرکدام در
`THIRD-PARTY-NOTICES.md` آمده‌اند؛ قانون انتشار: هیچ وابستگی‌ای که با
MIT/Apache-2.0 سازگار نباشد (مثل GPL/AGPL) نباید به ریلیز برسد.

---

# ReChat — Kick chat + Goal overlays for Meld Studio

ReChat takes live Kick chat and a Donofa goal and hands them to
Meld Studio as transparent overlays. No login; settings stay on
this machine.

## Features (through M5)

- **Live Kick chat** over Pusher (the same transport Kick's own site
  uses): username colors, badges, emotes, pinned messages, deletions,
  auto-reconnect, connection status
- **Live Donofa goal** polled every 10 seconds (no login)
- **Full customization + per-scene profiles** with their own overlay
  URLs (`/chat?profile=…`, `/goal?profile=…`), a highlighted CSS
  editor and live preview
- **In-app Meld guide** + fully transparent overlays (no Chroma Key)

## Run (Windows)

```sh
npm install
npm run tauri dev
```

Overlay links (while the app is running):

- Chat: `http://localhost:17874/chat`
- Goal: `http://localhost:17874/goal`

## License

ReChat is dual-licensed under **MIT or Apache-2.0, at your option**
(see `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`, `COPYRIGHT`).
Copyright © 2026 Taha Arefi.

Third-party components and their licenses are listed in
`THIRD-PARTY-NOTICES.md`. Release rule: no dependency incompatible
with MIT/Apache-2.0 (such as GPL/AGPL) may reach a release.
