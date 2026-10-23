#!/usr/bin/env node
'use strict';
// Exercise the *current* application against synthetic Firebase emulator data.
// Regression for PR #6: the fixed mobile nav intercepted "Add administrator".
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const adminRequire = createRequire(path.resolve(__dirname, '../functions/package.json'));
const { initializeApp } = adminRequire('firebase-admin/app');
const { getAuth } = adminRequire('firebase-admin/auth');
const { getFirestore } = adminRequire('firebase-admin/firestore');

const projectId = 'demo-patient-case-manager';
const app = initializeApp({ projectId });
const baseUrl = 'http://127.0.0.1:4173';
let server;
let browser;
let page;

async function waitForVite() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Local Vite app did not become available');
}

async function checkWidth(page, width) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (dimensions.document > dimensions.viewport + 3) {
    throw Error('Horizontal overflow at ' + width + 'px: ' + JSON.stringify(dimensions));
  }
}

/** Guard against the fullscreen navigation regression. Old CSS combined
 * top:69px (sticky tab bar) with bottom:0 (fixed bottom bar), stretching the
 * active navigation button across almost the entire phone screen. */
async function assertMobileNavigationGeometry(page, width, requireTitle = false) {
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav');
    const title = document.querySelector('.topbar h1');
    const navBox = nav?.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    const buttons = [...(nav?.querySelectorAll('button') ?? [])].map(button => {
      const bounds = button.getBoundingClientRect();
      return { top: bounds.top, height: bounds.height, bottom: bounds.bottom };
    });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      navTop: navBox?.top,
      navHeight: navBox?.height,
      navBottom: navBox?.bottom,
      navPosition: nav ? getComputedStyle(nav).position : null,
      titleTop: titleBox?.top,
      titleBottom: titleBox?.bottom,
      buttons,
    };
  });
  const invalidNav = layout.navPosition !== 'fixed' ||
    !Number.isFinite(layout.navTop) || !Number.isFinite(layout.navHeight) ||
    layout.navHeight > 100 || layout.navHeight < 48 ||
    Math.abs(layout.navBottom - layout.viewportHeight) > 5 ||
    layout.navTop < layout.viewportHeight - 115 ||
    layout.buttons.some(button => button.height > 85 || button.height < 30);
  if (invalidNav) {
    throw Error('Mobile navigation covers the workspace at ' + width + 'px: ' +
      JSON.stringify(layout));
  }
  if (requireTitle && (!Number.isFinite(layout.titleTop) ||
      layout.titleTop < 0 || layout.titleBottom >= layout.navTop)) {
    throw Error('Workspace heading is not visible above mobile navigation at ' +
      width + 'px: ' + JSON.stringify(layout));
  }
  console.log('PASS fixed mobile nav geometry at ' + width + 'px: bar ' +
    Math.round(layout.navHeight) + 'px high');
}

async function verifyAdministratorAction(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await assertMobileNavigationGeometry(page, width);
  await page.getByRole('button', { name: 'Administration', exact: true }).click();
  await page.getByRole('heading', { name: 'Administrators', exact: true }).waitFor();

  // A real pointer click, not force:true or DOM click. Fails if navigation
  // intercepts the button just as it did in the old PR #6 CI run.
  const add = page.getByRole('button', { name: 'Add administrator', exact: true });
  await add.click({ timeout: 12000 });
  await page.getByRole('button', { name: 'Invite administrator' }).waitFor();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Admin');
  await page.getByLabel('Email', { exact: true }).fill('synthetic-admin@example.test');
  await checkWidth(page, width);

  // Dismiss the draft without submitting any privileged write, then prove
  // that the mobile navigation itself remains clickable.
  await add.click({ timeout: 12000 });
  await page.getByRole('button', { name: 'Patients', exact: true }).click();
  await page.getByRole('heading', { name: 'Patients', exact: true, level: 1 }).waitFor();

  console.log('PASS mobile administrator controls and navigation at ' + width + 'px');
}

async function main() {
  const seeded = await getAuth(app).createUser({
    email: 'admin@clinic.test',
    password: 'LongPassword#1234',
    emailVerified: true,
  });
  await getFirestore(app).doc('users/' + seeded.uid).set({
    role: 'admin', active: true, displayName: 'Synthetic Clinic Admin',
    email: 'admin@clinic.test',
  });

  server = spawn(process.execPath, [
    path.resolve('node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4173', '--strictPort',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      VITE_FIREBASE_APP_ID: '1:1234567890:web:1234567890',
      VITE_USE_FIREBASE_EMULATORS: 'true',
    },
    stdio: 'inherit',
  });
  await waitForVite();

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Admin Login', exact: true }).click();
  await page.getByLabel('Admin email address').fill('admin@clinic.test');
  await page.locator('input[autocomplete="current-password"]').fill('LongPassword#1234');
  await page.getByRole('button', { name: 'Sign in as Admin', exact: true }).click();
  await page.getByRole('heading', { name: 'Clinic overview', exact: true, level: 1 })
    .waitFor({ timeout: 25000 });

  for (const width of [320, 360, 390, 414, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await assertMobileNavigationGeometry(page, width, true);
    await checkWidth(page, width);
    if (width === 390) {
      const folder = path.resolve('mobile-ui-screenshots');
      fs.mkdirSync(folder, { recursive: true });
      await page.screenshot({ path: path.join(folder, 'overview-mobile-390.png') });
    }
    await verifyAdministratorAction(page, width);
  }
  console.log('All mobile administrator smoke checks passed');
}

main().catch(async error => {
  console.error(error);
  if (page) {
    const folder = path.resolve('mobile-ui-screenshots');
    fs.mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: path.join(folder, 'admin-mobile-error.png'), fullPage: true })
      .catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (server) server.kill('SIGTERM');
  await app.delete();
});
