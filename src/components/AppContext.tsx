import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PLATFORM_SETTINGS,
  DEFAULT_TEMPLATES,
} from '../lib/catalog';
import {
  resolveCloudinaryConfig,
  type CloudinaryConfig,
} from '../lib/cloudinaryService';
import {
  loadLocalCategories,
  loadLocalMediaAssets,
  loadLocalSettings,
  loadLocalTemplates,
} from '../lib/indexedDbService';
import type {
  Category,
  MediaAsset,
  PlatformSettings,
  Template,
  ThemeMode,
} from '../lib/types';

interface AppContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  categories: Category[];
  templates: Template[];
  mediaAssets: MediaAsset[];
  settings: PlatformSettings;
  cloudinary: CloudinaryConfig;
  refreshCatalog: () => Promise<void>;
  refreshCloudinaryConfig: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('keepsake_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    }
    return 'light';
  });

  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [templates, setTemplates] = useState<Template[]>(DEFAULT_TEMPLATES);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [cloudinary, setCloudinary] = useState<CloudinaryConfig>({
    cloudName: String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim(),
    uploadPreset: String(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim(),
    source:
      import.meta.env.VITE_CLOUDINARY_CLOUD_NAME &&
      import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
        ? 'env'
        : 'unconfigured',
  });

  const applyThemeClass = (mode: ThemeMode) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }
  };

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem('keepsake_theme', mode);
    applyThemeClass(mode);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const refreshCloudinaryConfig = useCallback(async () => {
    const resolved = await resolveCloudinaryConfig();
    setCloudinary(resolved);
  }, []);

  const refreshCatalog = useCallback(async () => {
    const [loadedSettings, loadedCats, loadedTemplates, loadedMedia] = await Promise.all([
      loadLocalSettings(),
      loadLocalCategories(),
      loadLocalTemplates(),
      loadLocalMediaAssets(),
    ]);
    setSettings(loadedSettings);
    setCategories(loadedCats.filter((c) => c.enabled !== false).sort((a, b) => a.sortOrder - b.sortOrder));
    setTemplates(loadedTemplates.filter((t) => t.enabled !== false));
    setMediaAssets(loadedMedia.filter((m) => m.enabled !== false));
    if (!localStorage.getItem('keepsake_theme') && loadedSettings.defaultTheme) {
      setThemeState(loadedSettings.defaultTheme);
    }
  }, []);

  useEffect(() => {
    refreshCatalog().catch(() => {});
    refreshCloudinaryConfig().catch(() => {});
  }, [refreshCatalog, refreshCloudinaryConfig]);

  return (
    <AppContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        categories,
        templates,
        mediaAssets,
        settings,
        cloudinary,
        refreshCatalog,
        refreshCloudinaryConfig,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
