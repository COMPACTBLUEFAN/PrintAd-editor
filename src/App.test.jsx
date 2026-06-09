import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import App from './App';

// Мокаем GrapesJS, так как он использует canvas и сложный DOM, который не поддерживается JSDOM в полной мере.
vi.mock('grapesjs', () => {
  return {
    default: {
      init: vi.fn().mockReturnValue({
        on: vi.fn((event, callback) => {
          if (event === 'load') callback();
        }),
        destroy: vi.fn(),
        setComponents: vi.fn(),
        getHtml: vi.fn().mockReturnValue('<div>Mock</div>'),
        getCss: vi.fn().mockReturnValue('div { color: red; }'),
        Canvas: {
          setZoom: vi.fn(),
          getZoom: vi.fn().mockReturnValue(100),
          getDocument: vi.fn().mockReturnValue({
            querySelector: vi.fn(),
            createElement: vi.fn().mockReturnValue({ href: '' }),
            head: { appendChild: vi.fn() }
          })
        },
        Panels: { 
          getPanels: vi.fn(),
          removePanel: vi.fn(),
          getButton: vi.fn(),
          addButton: vi.fn()
        },
        Commands: {
          add: vi.fn(),
          run: vi.fn(),
          stop: vi.fn()
        },
        setDevice: vi.fn(),
      })
    }
  };
});

describe('App component', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    
    // Мокаем глобальный window.electronAPI для тестов
    window.electronAPI = {
      selectFolder: vi.fn(),
      readDir: vi.fn(),
      readFile: vi.fn(),
      exportTemplate: vi.fn(),
      selectImage: vi.fn(),
    };
  });

  it('renders the initial loader', () => {
    // Рендерим компонент без мокирования HTML (лоадер находится в index.html, но мы можем проверить App)
    const { container } = render(<App />);
    expect(container.querySelector('.app-container')).toBeInTheDocument();
  });

  it('shows tutorial modal on first launch (no localStorage)', () => {
    render(<App />);
    expect(screen.getByText('👋 Добро пожаловать!')).toBeInTheDocument();
    expect(screen.getByText(/🚀 Пройти базовое обучение/i)).toBeInTheDocument();
  });

  it('hides tutorial modal when skip is clicked', async () => {
    render(<App />);
    const skipButton = screen.getByText('Пропустить');
    fireEvent.click(skipButton);

    await waitFor(() => {
      expect(screen.queryByText('👋 Добро пожаловать!')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('tutorialDone')).toBe('true');
  });

  it('does not show tutorial modal if tutorialDone is in localStorage', () => {
    localStorage.setItem('tutorialDone', 'true');
    render(<App />);
    expect(screen.queryByText('👋 Добро пожаловать!')).not.toBeInTheDocument();
  });

  describe('Interface Interactions', () => {
    beforeEach(() => {
      localStorage.setItem('tutorialDone', 'true'); // Пропускаем туториал
    });

    it('calls electronAPI.selectFolder and readDir when "1. Папка с шаблонами" is clicked', async () => {
      window.electronAPI.selectFolder.mockResolvedValue('C:\\MockTemplates');
      window.electronAPI.readDir.mockResolvedValue({ success: true, files: ['template1.html', 'template2.html'] });
      
      render(<App />);
      
      const selectTemplateBtn = screen.getByText('1. Папка с шаблонами');
      fireEvent.click(selectTemplateBtn);
      
      expect(window.electronAPI.selectFolder).toHaveBeenCalled();
      
      await waitFor(() => {
        expect(window.electronAPI.readDir).toHaveBeenCalledWith('C:\\MockTemplates');
      });
      
      // Проверяем, что шаблоны добавились в селект
      const selectBox = screen.getByRole('combobox');
      expect(selectBox).not.toBeDisabled();
      expect(screen.getByText('template1.html')).toBeInTheDocument();
      expect(screen.getByText('template2.html')).toBeInTheDocument();
    });

    it('calls electronAPI.selectFolder and updates export path when "2. Куда сохранить" is clicked', async () => {
      window.electronAPI.selectFolder.mockResolvedValue('C:\\MockExport');
      render(<App />);
      
      const selectExportBtn = screen.getByText('2. Куда сохранить');
      fireEvent.click(selectExportBtn);
      
      expect(window.electronAPI.selectFolder).toHaveBeenCalled();
      
      await waitFor(() => {
        expect(screen.getByText('C:\\MockExport')).toBeInTheDocument();
      });
    });

    it('export buttons are disabled by default', () => {
      render(<App />);
      const pdfBtn = screen.getByText('В PDF');
      const pngBtn = screen.getByText('В PNG');
      const htmlBtn = screen.getByText('В HTML');
      
      expect(pdfBtn).toBeDisabled();
      expect(pngBtn).toBeDisabled();
      expect(htmlBtn).toBeDisabled();
    });

    it('enables export buttons and triggers export when both dirs and template are selected', async () => {
      // Имитируем, что папки уже выбраны (через хак с пропсами или мокая хуки, но проще прокликать интерфейс)
      window.electronAPI.selectFolder
        .mockResolvedValueOnce('C:\\MockTemplates')
        .mockResolvedValueOnce('C:\\MockExport');
      window.electronAPI.readDir.mockResolvedValue({ success: true, files: ['temp1.html'] });
      window.electronAPI.readFile.mockResolvedValue({ success: true, content: '<div>Test</div>' });
      window.electronAPI.exportTemplate.mockResolvedValue({ success: true, path: 'C:\\MockExport\\flyer_result.pdf' });

      render(<App />);
      
      // 1. Выбираем папку шаблонов
      fireEvent.click(screen.getByText('1. Папка с шаблонами'));
      await waitFor(() => expect(window.electronAPI.readDir).toHaveBeenCalled());
      
      // 2. Выбираем шаблон
      const selectBox = screen.getByRole('combobox');
      fireEvent.change(selectBox, { target: { value: 'temp1.html' } });
      
      // 3. Выбираем папку экспорта
      fireEvent.click(screen.getByText('2. Куда сохранить'));
      await waitFor(() => expect(screen.getByText('C:\\MockExport')).toBeInTheDocument());
      
      // Кнопки экспорта должны стать активными
      const pdfBtn = screen.getByText('В PDF');
      expect(pdfBtn).not.toBeDisabled();
      
      // 4. Кликаем экспорт в PDF
      fireEvent.click(pdfBtn);
      
      await waitFor(() => {
        expect(window.electronAPI.exportTemplate).toHaveBeenCalled();
      });
      
      // Проверяем, что вылез тост об успешном рендере
      expect(screen.getByText(/Успешно отрендерено в PDF/)).toBeInTheDocument();
    });

    it('updates export filename when user types in the input', () => {
      render(<App />);
      const input = screen.getByPlaceholderText('Имя файла');
      expect(input.value).toBe('flyer_result');
      
      fireEvent.change(input, { target: { value: 'new_flyer_name' } });
      expect(input.value).toBe('new_flyer_name');
    });

    it('toggles transparent background checkbox', () => {
      render(<App />);
      const checkbox = screen.getByLabelText('Без фона (PNG)');
      expect(checkbox).not.toBeChecked();
      
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });
  });
});
