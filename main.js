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
    
    // Даем немного времени на загрузку картинок
    await new Promise(resolve => setTimeout(resolve, 800));

    if (format === 'pdf') {
      const pdfData = await renderWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        marginsType: 1 // No margin
      });
      fs.writeFileSync(outPath, pdfData);
    } else if (format === 'png') {
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
      renderWin.setContentSize(dimensions.width, dimensions.height);
      
      // Даем 200мс на перерисовку после изменения размера
      await new Promise(resolve => setTimeout(resolve, 200));

      const image = await renderWin.webContents.capturePage();
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
