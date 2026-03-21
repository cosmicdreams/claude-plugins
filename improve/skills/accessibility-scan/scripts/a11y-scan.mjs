#!/usr/bin/env node

/**
 * Accessibility scan — runs Pa11y, axe-core, and Lighthouse against a site,
 * outputs a JSON score tuple for use in experiment improvement loops.
 *
 * Usage:
 *   node a11y-scan.mjs <base-url> [--max-pages 20] [--urls file.txt]
 *
 * Output (stdout): JSON score tuple
 * Progress (stderr): per-page status
 */

import pa11y from 'pa11y';
import puppeteer from 'puppeteer';
import { AxePuppeteer } from '@axe-core/puppeteer';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { URL } from 'url';
import https from 'https';
import http from 'http';

// --- CLI args ---
const args = process.argv.slice(2);
let baseUrl = null;
let maxPages = 20;
let urlListFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-pages' && args[i + 1]) {
    maxPages = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--urls' && args[i + 1]) {
    urlListFile = args[i + 1];
    i++;
  } else if (!args[i].startsWith('--')) {
    baseUrl = args[i].replace(/\/$/, '');
  }
}

if (!baseUrl) {
  console.error('Usage: node a11y-scan.mjs <base-url> [--max-pages 20] [--urls file.txt]');
  process.exit(1);
}

// --- Helpers ---

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = { rejectUnauthorized: false };
    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function discoverUrls(baseUrl, urlListFile, maxPages) {
  if (urlListFile) {
    const fs = await import('fs');
    const content = fs.readFileSync(urlListFile, 'utf-8');
    return content.split('\n').map(l => l.trim()).filter(Boolean).slice(0, maxPages);
  }

  const sitemapUrls = await tryParseSitemap(baseUrl);
  if (sitemapUrls.length > 0) {
    return sitemapUrls.slice(0, maxPages);
  }

  return await crawlHomepage(baseUrl, maxPages);
}

async function tryParseSitemap(baseUrl) {
  try {
    const { body, status } = await fetchUrl(`${baseUrl}/sitemap.xml`);
    if (status !== 200) return [];
    const locMatches = body.matchAll(/<loc>(.*?)<\/loc>/g);
    const urls = [];
    for (const m of locMatches) {
      urls.push(m[1]);
    }
    return urls;
  } catch {
    return [];
  }
}

async function crawlHomepage(baseUrl, maxPages) {
  try {
    const { body } = await fetchUrl(baseUrl);
    const origin = new URL(baseUrl).origin;
    const hrefMatches = body.matchAll(/href="([^"]+)"/g);
    const seen = new Set();
    const urls = [baseUrl];
    seen.add(baseUrl);

    for (const m of hrefMatches) {
      if (urls.length >= maxPages) break;
      let href = m[1];
      if (href.startsWith('/') && !href.startsWith('//')) {
        href = origin + href;
      }
      if (!href.startsWith(origin)) continue;
      if (seen.has(href)) continue;
      if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|xml|json|woff|ttf)(\?|$)/i.test(href)) continue;
      seen.add(href);
      urls.push(href);
    }
    return urls;
  } catch {
    return [baseUrl];
  }
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

// --- Scanners ---

async function runPa11y(url) {
  try {
    const result = await pa11y(url, {
      standard: 'WCAG2AA',
      timeout: 30000,
      chromeLaunchConfig: {
        args: ['--no-sandbox', '--ignore-certificate-errors'],
      },
      wait: 1000,
    });
    return {
      errors: result.issues.filter(i => i.type === 'error').length,
      warnings: result.issues.filter(i => i.type === 'warning').length,
      notices: result.issues.filter(i => i.type === 'notice').length,
    };
  } catch (err) {
    log(`  Pa11y error on ${url}: ${err.message}`);
    return { errors: -1, warnings: -1, notices: -1 };
  }
}

async function runAxe(url, browser) {
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const results = await new AxePuppeteer(page).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    await page.close();

    let critical = 0, serious = 0, moderate = 0, minor = 0;
    for (const v of results.violations) {
      const count = v.nodes.length;
      switch (v.impact) {
        case 'critical': critical += count; break;
        case 'serious': serious += count; break;
        case 'moderate': moderate += count; break;
        case 'minor': minor += count; break;
      }
    }
    return {
      violations: results.violations.length,
      critical,
      serious,
      moderate,
      minor,
      passes: results.passes.length,
    };
  } catch (err) {
    log(`  axe error on ${url}: ${err.message}`);
    return { violations: -1, critical: -1, serious: -1, moderate: -1, minor: -1, passes: -1 };
  }
}

async function runLighthouse(url, port) {
  try {
    const result = await lighthouse(url, {
      port,
      onlyCategories: ['accessibility'],
      output: 'json',
      logLevel: 'error',
    });
    const score = result.lhr.categories.accessibility.score;
    return { score: Math.round(score * 100) };
  } catch (err) {
    log(`  Lighthouse error on ${url}: ${err.message}`);
    return { score: -1 };
  }
}

// --- Main ---

async function main() {
  log(`Discovering pages from ${baseUrl}...`);
  const urls = await discoverUrls(baseUrl, urlListFile, maxPages);
  log(`Found ${urls.length} pages to scan.\n`);

  if (urls.length === 0) {
    console.log(JSON.stringify({ error: 'No pages found to scan' }));
    process.exit(1);
  }

  // Launch Chrome for Lighthouse (shared port)
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--ignore-certificate-errors'],
  });

  // Launch Puppeteer for axe-core
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
  });

  const perPage = [];
  let totalPa11yErrors = 0, totalPa11yWarnings = 0;
  let totalAxeViolations = 0, totalAxeCritical = 0, totalAxeSerious = 0;
  let lighthouseScores = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    log(`[${i + 1}/${urls.length}] ${url}`);

    // Run all three tools in parallel per page
    const [pa11yResult, axeResult, lhResult] = await Promise.all([
      runPa11y(url),
      runAxe(url, browser),
      runLighthouse(url, chrome.port),
    ]);

    const pageResult = { url, pa11y: pa11yResult, axe: axeResult, lighthouse: lhResult };
    perPage.push(pageResult);

    if (pa11yResult.errors >= 0) {
      totalPa11yErrors += pa11yResult.errors;
      totalPa11yWarnings += pa11yResult.warnings;
    }
    if (axeResult.violations >= 0) {
      totalAxeViolations += axeResult.violations;
      totalAxeCritical += axeResult.critical;
      totalAxeSerious += axeResult.serious;
    }
    if (lhResult.score >= 0) {
      lighthouseScores.push(lhResult.score);
    }
  }

  await browser.close();
  await chrome.kill();

  const avgLighthouse = lighthouseScores.length > 0
    ? Math.round(lighthouseScores.reduce((a, b) => a + b, 0) / lighthouseScores.length)
    : -1;

  const output = {
    scores: {
      lighthouse: avgLighthouse,
      axe_total: totalAxeViolations,
      axe_critical: totalAxeCritical,
      axe_serious: totalAxeSerious,
      pa11y_errors: totalPa11yErrors,
      pa11y_warnings: totalPa11yWarnings,
      pages: urls.length,
    },
    per_page: perPage,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
