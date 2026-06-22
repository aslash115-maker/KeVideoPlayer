// Headless screenshot using Electron BrowserWindow.
// Loads docs/manual.html at 1600px wide, captures full content, writes JPG.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const HTML_PATH = path.join(__dirname, '..', 'docs', 'manual.html');
const OUT_JPG = path.join(__dirname, '..', 'docs', 'manual.jpg');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1200,
    webPreferences: {
      offscreen: false,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(HTML_PATH);

  // Wait until layout is settled and let fonts/styles paint.
  await new Promise((r) => setTimeout(r, 500));

  // Get the actual scrollHeight so we can resize the window to capture it all.
  const height = await win.webContents.executeJavaScript(
    'document.documentElement.scrollHeight'
  );

  console.log('Document height:', height);
  win.setContentSize(1600, height);
  await new Promise((r) => setTimeout(r, 300));

  const image = await win.webContents.capturePage();
  const jpg = image.toJPEG(95);
  await fs.writeFile(OUT_JPG, jpg);
  console.log('Wrote', OUT_JPG, '(', jpg.length, 'bytes )');

  win.close();
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
