import React, { useState, useEffect, useRef } from 'react';
import grapesjs from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import webpagePlugin from 'grapesjs-preset-webpage';
import basicBlocksPlugin from 'grapesjs-blocks-basic';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './App.css';

function App() {
  const [templateDir, setTemplateDir] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [exportDir, setExportDir] = useState(null);
  const [exportFilename, setExportFilename] = useState('flyer_result');
  const [isExporting, setIsExporting] = useState(false);
  const [transparentBg, setTransparentBg] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error'|'info', message: string }
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  
  const editorRef = useRef(null);
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('tutorialDone')) {
      setShowTutorialModal(true);
    }
  }, []);

  // Инициализация GrapesJS один раз при монтировании
  useEffect(() => {
    if (!editorRef.current) return;
    
    const e = grapesjs.init({
      container: editorRef.current,
      fromElement: false,
      height: '100%',
      width: 'auto',
      dragMode: 'absolute', // Позволяет двигать элементы свободно, как в Figma/Canva
      storageManager: false, // Не сохраняем локально, мы используем файловую систему
      plugins: [webpagePlugin, basicBlocksPlugin],
      pluginsOpts: {
        [webpagePlugin]: {
          // Настройки плагина webpage (скрываем сложные вещи по умолчанию)
          blocksBasicOpts: { flexGrid: true },
          formsOpts: false,
          navbarOpts: false,
          countdownOpts: false,
        }
      },
      assetManager: {
        // Кастомная загрузка картинок через Electron
        custom: {
          open(props) {
            window.electronAPI.selectImage().then((base64) => {
              if (base64) {
                e.AssetManager.add(base64);
                if (props.options && props.options.target) {
                  props.options.target.set('src', base64);
                }
                props.close();
              }
            });
          },
          close(props) {}
        }
      },
      canvas: {
        styles: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap']
      }
    });

    // Скрываем панели, которые могут запутать новичка, оставляем Блоки, Стили и Слои
    const panels = e.Panels;
    panels.removePanel('devices-c'); // Выбор устройства (мобилка/пк) - для листовок не нужно
    
    // Добавляем кастомную кнопку для вызова загрузки картинки (заглушка для красоты, Asset Manager работает через двойной клик)
    e.Commands.add('open-assets', {
      run(editor) {
        editor.AssetManager.open();
      }
    });

    setEditor(e);

    e.on('load', () => {
      // Скрываем первоначальный лоадер
      const loader = document.getElementById('initial-loader');
      if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 500);
      }
      
      // Инициализируем уровень зума
      setZoomLevel(Math.round(e.Canvas.getZoom()));
    });

    e.on('canvas:zoom', () => {
      setZoomLevel(Math.round(e.Canvas.getZoom()));
    });

    return () => {
      e.destroy();
    };
  }, []);

  const handleSelectTemplateFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setTemplateDir(folder);
      const res = await window.electronAPI.readDir(folder);
      if (res.success) {
        setTemplates(res.files);
        setSelectedTemplate('');
        if (editor) editor.setComponents(''); // Очищаем редактор
      }
    }
  };

  const handleSelectExportFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) setExportDir(folder);
  };

  useEffect(() => {
    if (selectedTemplate && templateDir && editor) {
      loadTemplate(`${templateDir}\\${selectedTemplate}`);
    }
  }, [selectedTemplate]);

  const loadTemplate = async (path) => {
    const res = await window.electronAPI.readFile(path);
    if (res.success) {
      const baseUrl = 'file:///' + templateDir.replace(/\\/g, '/') + '/';
      let content = res.content;
      
      // Чтобы картинки с относительными путями 100% грузились в GrapesJS (так как <base> тег может применяться поздно),
      // мы заменяем все url('...') и src="..." на абсолютные file:///... пути перед загрузкой.
      content = content.replace(/url\(['"]?(?!http|data:|file:)([^)'"]+)['"]?\)/gi, "url('" + baseUrl + "$1')");
      content = content.replace(/src=['"](?!http|data:|file:)([^'"]+)['"]/gi, "src=\"" + baseUrl + "$1\"");

      editor.setComponents(content);
      
      // Тег <base> всё еще может быть полезен для других ресурсов.
      const wrapper = editor.Canvas.getDocument();
      if (wrapper) {
        let baseTag = wrapper.querySelector('base');
        if (!baseTag) {
          baseTag = wrapper.createElement('base');
          wrapper.head.appendChild(baseTag);
        }
        baseTag.href = baseUrl;
      }
    }
  };

  const handleExport = async (format) => {
    if (!exportDir || !editor) return;
    
    // Получаем финальный HTML и CSS из GrapesJS
    let htmlContent = editor.getHtml();
    const cssContent = editor.getCss();
    
    // Очищаем абсолютные пути обратно в относительные для чистой выгрузки
    const baseUrl = 'file:///' + templateDir.replace(/\\/g, '/') + '/';
    htmlContent = htmlContent.replace(new RegExp(baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${cssContent}</style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

    setIsExporting(true);
    showToast('info', `⏳ Рендеринг ${format.toUpperCase()}...`);

    const res = await window.electronAPI.exportTemplate({
      html: fullHtml,
      format,
      outDir: exportDir,
      filename: exportFilename || 'output',
      baseDir: templateDir,
      transparentBg
    });

    setIsExporting(false);

    if (res.success) {
      showToast('success', `✅ Успешно отрендерено в ${format.toUpperCase()}!\n${res.path}`);
    } else {
      showToast('error', '❌ Ошибка экспорта: ' + res.error);
    }
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    if (type !== 'info') {
      setTimeout(() => setToast(null), 5000); // Скрываем через 5 сек, если это не процесс загрузки
    }
  };

  const isReady = !!(selectedTemplate && exportDir && !isExporting);

  const handleZoom = (amount) => {
    if (!editor) return;
    const currentZoom = editor.Canvas.getZoom();
    editor.Canvas.setZoom(currentZoom + amount);
  };

  const startTutorial = (type) => {
    setShowTutorialModal(false);
    localStorage.setItem('tutorialDone', 'true');

    const basicSteps = [
      { element: '.topbar-group:nth-child(1)', popover: { title: '1. Шаблоны', description: 'Сначала выберите папку на компьютере, где лежат ваши шаблоны (например, папка Templates). Затем выберите конкретный макет из выпадающего списка.', side: 'bottom', align: 'start' } },
      { element: '.topbar-group:nth-child(2)', popover: { title: '2. Сохранение', description: 'Укажите папку, куда будут сохраняться готовые листовки (например, Results). И введите имя файла (без расширения).', side: 'bottom', align: 'start' } },
      { element: '.zoom-controls', popover: { title: 'Масштабирование', description: 'Используйте кнопки + и - для удобного зума. Также можно крутить колесико мыши с зажатым Ctrl.', side: 'bottom', align: 'center' } },
      { element: '.editor-workspace', popover: { title: 'Редактор (Холст)', description: 'Это ваша рабочая область. Вы можете выделить любой текст двойным кликом, чтобы изменить его. Любой элемент можно перетащить мышкой.', side: 'left', align: 'center' } },
      { element: '.gjs-pn-views-container', popover: { title: 'Правая панель', description: 'Здесь находятся настройки выделенного элемента: цвета, шрифты, отступы и блоки для добавления.', side: 'left', align: 'start' } },
      { element: '.topbar-group:nth-child(3)', popover: { title: '3. Экспорт', description: 'Когда закончите редактирование, выберите нужный формат: PDF (для печати), PNG (картинка) или HTML (для разработчиков).', side: 'bottom', align: 'start' } }
    ];

    const advancedSteps = [
      ...basicSteps,
      { element: '.topbar-group:nth-child(3) label', popover: { title: 'Прозрачный фон', description: 'Эта настройка убирает белый фон (бумагу) при экспорте в PNG. Полезно, если вы делаете наклейку или графику для вставки на сайт с другим фоном.', side: 'bottom', align: 'center' } },
      { element: '.html-btn', popover: { title: 'Экспорт в HTML', description: 'Если вы не доделали макет и хотите сохранить его как черновик, экспортируйте в HTML. В следующий раз вы сможете просто положить этот HTML файл в папку шаблонов и продолжить работу с ним!', side: 'bottom', align: 'end' } },
      { element: '.gjs-pn-views .gjs-pn-btn:nth-child(4)', popover: { title: '➕ Добавление блоков', description: 'Иконка "Плюс" открывает панель блоков. Хватайте любой блок (Текст, Картинка, 2 Колонки) и тащите его прямо на холст. Так собирается структура макета.', side: 'left', align: 'start' } },
      { element: '.gjs-pn-views .gjs-pn-btn:nth-child(1)', popover: { title: '🎨 Менеджер стилей', description: 'Иконка "Кисточка". Выделите элемент на холсте и зайдите сюда. Здесь можно настроить вообще всё: изменить шрифт (Typography), задать цвет текста, добавить тени (Decorations) и сделать отступы (Margin/Padding).', side: 'left', align: 'start' } },
      { element: '.gjs-pn-views .gjs-pn-btn:nth-child(2)', popover: { title: '⚙️ Менеджер свойств', description: 'Иконка "Шестеренка". Здесь настраиваются технические параметры. Например, если вы выделили картинку, тут можно загрузить само изображение (параметр Src) или прописать ссылку.', side: 'left', align: 'start' } },
      { element: '.gjs-pn-views .gjs-pn-btn:nth-child(3)', popover: { title: '📚 Менеджер слоев', description: 'Иконка "Слои". Это дерево всех элементов (как в Photoshop или Figma). Если элемент "спрятался" под другим или вы не можете по нему кликнуть — найдите его здесь в списке.', side: 'left', align: 'start' } },
      { element: '.gjs-pn-options .gjs-pn-btn:nth-child(4)', popover: { title: 'Кнопка "Код" </>', description: 'Иконка `</>` на темной панели сверху. Открывает сырой HTML и CSS код. Вы можете напрямую вносить туда правки, если разбираетесь в веб-разработке.', side: 'bottom', align: 'start' } }
    ];

    const driverObj = driver({
      showProgress: true,
      nextBtnText: 'Далее ➔',
      prevBtnText: '⬅ Назад',
      doneBtnText: 'Понятно',
      steps: type === 'advanced' ? advancedSteps : basicSteps
    });

    driverObj.drive();
  };

  return (
    <div className="app-container" style={{ flexDirection: 'column' }}>
      
      {/* Кастомное уведомление */}
      {toast && (
        <div style={{
          position: 'absolute',
          bottom: '30px',
          right: '30px',
          backgroundColor: toast.type === 'error' ? '#f44336' : (toast.type === 'success' ? '#4caf50' : '#2196f3'),
          color: '#fff',
          padding: '16px 24px',
          borderRadius: '12px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontFamily: 'Inter, sans-serif',
          fontWeight: '600',
          animation: 'slideIn 0.3s ease-out forwards',
          whiteSpace: 'pre-line'
        }}>
          {toast.message}
          {toast.type !== 'info' && (
            <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '10px', fontWeight: 'bold' }}>✕</button>
          )}
        </div>
      )}

      {/* Модальное окно туториала */}
      {showTutorialModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10000,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: '#1e1e1e', padding: '40px', borderRadius: '16px', color: '#fff',
            maxWidth: '500px', textAlign: 'center', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid #333'
          }}>
            <h2 style={{ margin: '0 0 15px 0', fontSize: '24px' }}>👋 Добро пожаловать!</h2>
            <p style={{ color: '#aaa', marginBottom: '30px', fontSize: '15px', lineHeight: '1.5' }}>Хотите пройти быстрое обучение по интерфейсу программы, чтобы узнать, как всё работает?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button className="btn" style={{ background: '#3b82f6', padding: '12px', fontSize: '16px' }} onClick={() => startTutorial('basic')}>🚀 Пройти базовое обучение (1 мин)</button>
              <button className="btn" style={{ background: '#10b981', padding: '12px', fontSize: '16px' }} onClick={() => startTutorial('advanced')}>🛠 Пройти продвинутое обучение (Детально)</button>
              <button className="btn" style={{ background: 'transparent', border: '1px solid #555', color: '#888', marginTop: '10px' }} onClick={() => { setShowTutorialModal(false); localStorage.setItem('tutorialDone', 'true'); }}>Пропустить</button>
            </div>
          </div>
        </div>
      )}

      {/* Верхняя панель управления */}
      <div className="topbar">
        <div className="topbar-group">
          <button className="btn" onClick={handleSelectTemplateFolder}>1. Папка с шаблонами</button>
          <select 
            className="select-box" 
            value={selectedTemplate} 
            onChange={(e) => setSelectedTemplate(e.target.value)}
            disabled={templates.length === 0}
            style={{ minWidth: '200px' }}
          >
            <option value="">-- Выберите шаблон --</option>
            {templates.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="topbar-group">
          <button className="btn" onClick={handleSelectExportFolder}>2. Куда сохранить</button>
          <div className="path-text" title={exportDir || 'Не выбрана'}>
            {exportDir ? (exportDir.length > 20 ? '...'+exportDir.slice(-20) : exportDir) : 'Не выбрана'}
          </div>
          <input 
            type="text" 
            className="input-field" 
            style={{ width: '150px' }}
            value={exportFilename} 
            onChange={e => setExportFilename(e.target.value)}
            placeholder="Имя файла"
          />
        </div>

        <div className="topbar-group" style={{ alignItems: 'center' }}>
          <div className="zoom-controls" style={{ display: 'flex', gap: '5px', marginRight: '15px' }}>
            <button className="btn" style={{ padding: '8px 12px', backgroundColor: '#333', color: '#fff' }} onClick={() => handleZoom(-10)}>-</button>
            <button className="btn" style={{ padding: '8px 12px', backgroundColor: '#333', color: '#fff', minWidth: '60px' }} onClick={() => { if(editor) editor.Canvas.setZoom(100); }}>{zoomLevel}%</button>
            <button className="btn" style={{ padding: '8px 12px', backgroundColor: '#333', color: '#fff' }} onClick={() => handleZoom(10)}>+</button>
          </div>

          <label style={{ marginRight: '10px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input type="checkbox" checked={transparentBg} onChange={e => setTransparentBg(e.target.checked)} />
            Без фона (PNG)
          </label>
          <button className="btn pdf-btn" disabled={!isReady} onClick={() => handleExport('pdf')}>В PDF</button>
          <button className="btn png-btn" disabled={!isReady} onClick={() => handleExport('png')}>В PNG</button>
          <button className="btn html-btn" disabled={!isReady} onClick={() => handleExport('html')}>В HTML</button>
          <button className="btn" style={{ background: 'transparent', border: '1px solid #ccc', color: '#333', marginLeft: '15px' }} onClick={() => setShowTutorialModal(true)}>❓ Помощь</button>
        </div>
      </div>

      {/* Редактор GrapesJS */}
      <div className="editor-workspace" style={{ flex: 1, position: 'relative' }}>
        <div id="gjs" ref={editorRef}></div>
      </div>

    </div>
  );
}

export default App;
