// اختبارات المتصفح (Playwright). تتطلب تشغيل البيئة المحلية أولًا:
//   bash scripts/e2e-stack.sh start   ثم   npx playwright test
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,               // قاعدة بيانات مشتركة → تشغيل تسلسلي
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'ar',
    timezoneId: 'Asia/Baghdad',
    acceptDownloads: true,
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
});
