import '@expo/metro-runtime';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const basePath = new URL('./', document.baseURI).pathname;
    navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath })
      .catch(error => console.warn('Offline cache registration unavailable:', error));
  });
}
