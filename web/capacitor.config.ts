import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.kimoto.reader',
  appName: 'Kimoto',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Self-hosted servers on a home network are often plain http://192.168.x.x:4000.
    cleartext: true,
  },
  android: {
    // The bundled app runs on https://localhost; this lets it talk to an http:// LAN server.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#0d0f17', showSpinner: false },
    LocalNotifications: { smallIcon: 'ic_stat_kimoto', iconColor: '#8b7cff' },
  },
};

export default config;
