const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    title: 'PrintAd Constructor',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg', 'svg', 'webp'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) return null;
  
  const filePath = result.filePaths[0];
  const fileData = fs.readFileSync(filePath);
  const ext = path.extname(filePath).replace('.', '') || 'png';
  const base64 = `data:image/${ext};base64,${fileData.toString('base64')}`;
  return base64;
});

ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath);
    return { success: true, files: files.filter(f => f.endsWith('.html')) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-template', async (event, { html, format, outDir, filename, baseDir, transparentBg }) => {
  try {
    const outPath = path.join(outDir, `${filename}.${format}`);
    
    if (format === 'html') {
      fs.writeFileSync(outPath, html, 'utf-8');
      return { success: true, path: outPath };
    }

    let finalHtml = html;
    if (transparentBg && format === 'png') {
      // Инжектим CSS для прозрачного фона
      finalHtml = finalHtml.replace('</head>', '<style>body, .flyer { background-color: transparent !important; }</style></head>');
    }

    // Для PDF и PNG создаем временный файл в папке с шаблоном, 
    // чтобы относительные пути (на картинки) разрешались корректно.
    const temptDir = path.join(baseDir, 'Tempt');
    if (!fs.existsSync(temptDir)) {
      fs.mkdirSync(temptDir, { recursive: true });
    }
    const tempHtmlPath = path.join(temptDir, `temp_render_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, finalHtml, 'utf-8');

    const renderWin = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      transparent: transparentBg && format === 'png', // Важно для прозрачного PNG
      webPreferences: {
        nodeIntegration: false,
        webSecurity: false
      }
    });

    await renderWin.loadFile(tempHtmlPath);

    // Ожидаем окончания загрузки всех картинок, чтобы не было пустых блоков или QR-кодов
    await renderWin.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const checkImages = () => {
          const images = Array.from(document.images);
          const unloaded = images.filter(img => !img.complete);
          if (unloaded.length === 0) resolve();
          else {
            let loadedCount = 0;
            unloaded.forEach(img => {
              img.onload = img.onerror = () => {
                loadedCount++;
                if (loadedCount === unloaded.length) resolve();
              };
            });
          }
        };
        if (document.readyState === 'complete') checkImages();
        else window.addEventListener('load', checkImages);
      })
    `);

    // Даем немного времени на перерисовку после загрузки
    await new Promise(resolve => setTimeout(resolve, 300));

    // Вычисляем реальную высоту контента
    const dimensions = await renderWin.webContents.executeJavaScript(`
      (() => {
        const style = document.createElement('style');
        style.textContent = 'html, body { padding: 0 !important; margin: 0 !important; background: transparent !important; min-height: 0 !important; width: fit-content !important; height: fit-content !important; overflow: hidden !important; } .flyer { box-shadow: none !important; margin: 0 !important; }';
        document.head.appendChild(style);
        
        const flyer = document.querySelector('.flyer');
        return {
          width: flyer ? flyer.offsetWidth : document.documentElement.scrollWidth,
          height: flyer ? flyer.offsetHeight : document.documentElement.scrollHeight
        };
      })();
    `);
      
    // Устанавливаем высоту окна по контенту
    renderWin.setContentSize(Math.round(dimensions.width), Math.round(dimensions.height));
    
    // Даем 200мс на перерисовку после изменения размера
    await new Promise(resolve => setTimeout(resolve, 200));

    if (format === 'pdf') {
      const pdfData = await renderWin.webContents.printToPDF({
        printBackground: true,
        pageSize: {
          width: Math.round(dimensions.width) * 264.5833, // Конвертация пикселей в микроны
          height: Math.round(dimensions.height) * 264.5833
        },
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });
      fs.writeFileSync(outPath, pdfData);
    } else if (format === 'png') {
      const image = await renderWin.webContents.capturePage({
        x: 0,
        y: 0,
        width: Math.round(dimensions.width),
        height: Math.round(dimensions.height)
      });
      fs.writeFileSync(outPath, image.toPNG());
    }

    // Очистка
    renderWin.destroy();
    fs.unlinkSync(tempHtmlPath);

    return { success: true, path: outPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
