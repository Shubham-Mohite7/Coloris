# coloris

Coloris is a premium single-page camera palette app built with React 18, Vite, and Tailwind CSS. It samples the live camera feed every second with HTML5 Canvas, extracts a deduplicated palette, and lets you copy or capture colors instantly.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. Camera access requires a secure context, so `localhost` works in modern browsers.

## Production build

```bash
npm run build
npm run preview
```

## Features

- Full-screen live camera feed
- Real-time palette extraction every 1 second
- Canvas grid sampling with similar-color deduplication
- 6-8 large frosted glass swatches with HEX, RGB, and one-click copy
- Tap/click video sampling for a specific color
- Start/stop camera control, status indicator, and permission handling
- Frame capture and PNG download
- Mobile-friendly responsive interface
