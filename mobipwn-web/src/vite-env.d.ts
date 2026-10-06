/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_API_URL?: string;
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}

declare module "@/vendor/website-advanced/iphone/idevice-demo-app.js" {
  export function bootIphoneAdvanced(): Promise<void>;
  export function resetIphoneAdvancedBoot(): void;
}

declare module "@/vendor/website-advanced/android/android-advanced-app.js" {
  export function bootAndroidAdvanced(): Promise<void>;
  export function resetAndroidAdvancedBoot(): void;
}
