import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

type ThemeMode = 'light' | 'dark' | 'system';
const THEME_KEY = 'echo_mentor_theme';

interface ThemeCtx {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setThemeMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ themeMode: 'system', resolvedTheme: 'light', setThemeMode: () => {} });

/** 主题上下文：浅色/深色/跟随系统。Web 端通过 documentElement.classList 驱动 CSS 变量切换 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [themeMode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    (async () => {
      try {
        const v = (await AsyncStorage.getItem(THEME_KEY)) as ThemeMode | null;
        if (v === 'light' || v === 'dark' || v === 'system') setMode(v);
      } catch { /* ignore */ }
    })();
  }, []);

  const resolvedTheme: 'light' | 'dark' = themeMode === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    if (Platform_web()) {
      const root = document.documentElement;
      root.classList.toggle('dark', resolvedTheme === 'dark');
      root.style.colorScheme = resolvedTheme;
    }
  }, [resolvedTheme]);

  const setThemeMode = (m: ThemeMode) => {
    setMode(m);
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  };

  const value = useMemo(() => ({ themeMode, resolvedTheme, setThemeMode }), [themeMode, resolvedTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Platform_web(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function useTheme() {
  return useContext(Ctx);
}
