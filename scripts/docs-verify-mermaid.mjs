import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { chromium } from '../packages/dashboard/node_modules/playwright/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    // Fall back to system chrome if standard Playwright chromium is not pre-installed
    return await chromium.launch({ channel: 'chrome', headless: true });
  }
}

async function verifyChapterMermaid(page, relativeHtmlPath, expectedLabels, screenshotPath) {
  const fullHtmlPath = path.join(REPO_ROOT, 'docs', 'book', relativeHtmlPath);
  if (!fs.existsSync(fullHtmlPath)) {
    throw new Error(`Built book HTML file not found: ${fullHtmlPath}. Did you run "mdbook build docs"?`);
  }

  const fileUrl = `file://${fullHtmlPath}`;
  console.log(`Checking Mermaid diagram in: ${relativeHtmlPath}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // 1. Wait for the SVG element rendered by mermaid.js inside .mermaid container
  const svgSelector = '.mermaid svg';
  try {
    await page.waitForSelector(svgSelector, { timeout: 15000 });
  } catch (err) {
    throw new Error(`Timeout waiting for Mermaid SVG ("${svgSelector}") in ${relativeHtmlPath}. Diagram failed to render.`);
  }

  const svgContent = await page.$eval(svgSelector, (el) => el.outerHTML);
  if (!svgContent || svgContent.length < 50) {
    throw new Error(`Rendered SVG in ${relativeHtmlPath} appears empty or truncated (length: ${svgContent?.length}).`);
  }

  // 2. Assert SVG contains required node labels
  for (const label of expectedLabels) {
    if (!svgContent.includes(label)) {
      throw new Error(`Rendered SVG in ${relativeHtmlPath} does not contain expected node label: "${label}"`);
    }
  }

  // 3. Assert raw diagram definition text is NOT visible to the reader
  const bodyText = await page.innerText('body');
  if (bodyText.includes('flowchart TD')) {
    throw new Error(`Raw "flowchart TD" text is visible on the page in ${relativeHtmlPath}. Mermaid block did not render cleanly.`);
  }

  // 4. Save screenshot
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  ✓ Verified SVG rendering. Contains: ${expectedLabels.join(', ')}`);
  console.log(`  ✓ Raw "flowchart TD" is NOT visible`);
  console.log(`  ✓ Screenshot saved to: ${screenshotPath}`);
}

async function main() {
  console.log('=== Verifying Mermaid Diagram Rendering via Headless Browser ===\n');

  // Ensure book is built
  const bookDir = path.join(REPO_ROOT, 'docs', 'book');
  if (!fs.existsSync(bookDir)) {
    console.log('Building docs first...');
    execSync('mdbook build docs', { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error('❌ Failed to launch browser for Mermaid verification:', err.message);
    process.exit(1);
  }

  try {
    const page = await browser.newPage();

    // 1. Check ch03-concepts.html
    await verifyChapterMermaid(
      page,
      'ch03-concepts.html',
      ['BIP-39 Mnemonic Seed', 'Unified Address', 'Unified Full Viewing Key'],
      '/tmp/mermaid-concepts.png'
    );

    // 2. Check ch01-introduction.html
    await verifyChapterMermaid(
      page,
      'ch01-introduction.html',
      ['Next.js Application', 'TypeScript SDK', 'Zebra Consensus Node'],
      '/tmp/mermaid-intro.png'
    );

    console.log('\n🎉 All Mermaid diagrams render to valid SVGs with correct labels and no raw syntax leak!\n');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Mermaid verification failed:', err.message);
  process.exit(1);
});

