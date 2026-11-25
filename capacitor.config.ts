import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kriptoarena.app',
  appName: 'Kripto Arena',
  webDir: 'dist',
  android: { backgroundColor: '#0B0E14' },
  plugins: {
    StatusBar: { backgroundColor: '#0B0E14', style: 'DARK', overlaysWebView: false },
  },
};

export default config;
