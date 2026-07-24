#!/usr/bin/env node

/**
 * Run the public ShieldVault Detection Anthology against the exact detector
 * logic shipped in content-script.js.
 *
 * This harness intentionally does not copy detector regexes or behavioral
 * rules. It loads the detector section directly from content-script.js into a
 * Node VM with controlled settings, then classifies every public anthology
 * case as STOP, PAUSE, or ALLOW.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const anthologyDir = path.resolve(
  process.argv[2] || path.join(repoRoot, "../shieldvault-anthology/anthology/cases")
);
const contentScriptPath = path.join(repoRoot, "content-script.js");
const reportDir = path.join(repoRoot, "tests", "anthology", "artifacts");
const reportPath = path.join(reportDir, "production-anthology-report.json");

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

if (!fs.existsSync(contentScriptPath)) fatal(`missing ${contentScriptPath}`);
if (!fs.existsSync(anthologyDir)) fatal(`missing anthology directory ${anthologyDir}`);

const source = fs.readFileSync(contentScriptPath, "utf8");
const startMarker = "// PATTERN LIBRARY";
const endMarker = "// CORE ACTIONS";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  fatal("could not isolate detector section from content-script.js; marker contract changed");
}

const detectorSource = source.slice(start, end);
const bootstrap = `
let SHIELDVAULT_SETTINGS = {
  secretGuard: true,
  tokenGuard: true,
  passwordGuard: true,
  recoveryPhraseGuard: true,
  privateInfoGuard: true,
  clientDataGuard: true,
  largePasteGuard: true,
  reputationGuard: true,
  lateNightPostAlert: false,
  emotionalPostWarning: true,
  soundOnBlock: false,
  emailReviewGuard: true,
  phoneReviewGuard: true,
};
`;

const context = vm.createContext({ console });
vm.runInContext(`${bootstrap}\n${detectorSource}`, context, {
  filename: "shieldvault-detector-under-test.js",
  timeout: 2000,
});

function runExpression(expression, text) {
  context.__ANTHOLOGY_TEXT__ = text;
  return vm.runInContext(expression, context, { timeout: 1000 });
}

function classify(caseData) {
  if (caseData.domain === "secret") {
    const matches = runExpression("detectSecretMatches(__ANTHOLOGY_TEXT__)", caseData.text);
    return matches.some((match) => match && match.soft === false) ? "STOP" : "ALLOW";
  }

  if (caseData.domain === "behavior") {
    const matches = runExpression("detectBehaviors(__ANTHOLOGY_TEXT__)", caseData.text);
    return matches.length > 0 ? "PAUSE" : "ALLOW";
  }

  throw new Error(`unsupported domain ${caseData.domain}`);
}

function permittedOutcomes(caseData) {
  if (Array.isArray(caseData.acceptable) && caseData.acceptable.length) {
    return new Set(caseData.acceptable);
  }
  return new Set([caseData.expected]);
}

const files = fs
  .readdirSync(anthologyDir)
  .filter((name) => name.endsWith(".json"))
  .sort();
if (!files.length) fatal("no anthology JSON files found");

const rows = [];
for (const filename of files) {
  const payload = JSON.parse(fs.readFileSync(path.join(anthologyDir, filename), "utf8"));
  for (const caseData of payload.cases || []) {
    const observed = classify(caseData);
    const permitted = permittedOutcomes(caseData);
    const prohibited = new Set(caseData.must_not || []);
    const pass = permitted.has(observed) && !prohibited.has(observed);
    rows.push({
      id: caseData.id,
      domain: caseData.domain,
      category: caseData.category,
      expected: caseData.expected,
      observed,
      pass,
      releaseBlocker: caseData.release_blocker === true,
      permitted: [...permitted],
      mustNot: [...prohibited],
    });
  }
}

let failures = 0;
let blockerFailures = 0;
for (const row of rows) {
  if (row.pass) {
    console.log(`PASS ${row.id}  ${row.domain}  ${row.observed}`);
  } else {
    failures += 1;
    if (row.releaseBlocker) blockerFailures += 1;
    console.error(
      `FAIL ${row.id}  ${row.domain}  observed=${row.observed} expected=${row.expected} permitted=${row.permitted.join("|")}` +
        (row.releaseBlocker ? "  RELEASE_BLOCKER" : "")
    );
  }
}

const secretRows = rows.filter((row) => row.domain === "secret");
const behaviorRows = rows.filter((row) => row.domain === "behavior");
const passed = rows.length - failures;
const summary = {
  generatedAt: new Date().toISOString(),
  cases: rows.length,
  passed,
  failed: failures,
  releaseBlockerFailures: blockerFailures,
  secrets: {
    passed: secretRows.filter((row) => row.pass).length,
    total: secretRows.length,
  },
  behavior: {
    passed: behaviorRows.filter((row) => row.pass).length,
    total: behaviorRows.length,
  },
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({ summary, results: rows }, null, 2)}\n`, "utf8");

console.log("\nShieldVault production detector anthology report");
console.log(`Cases: ${rows.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failures}`);
console.log(`Release-blocker failures: ${blockerFailures}`);
console.log(`Secrets: ${summary.secrets.passed}/${summary.secrets.total}`);
console.log(`Behavior: ${summary.behavior.passed}/${summary.behavior.total}`);
console.log(`Report: ${reportPath}`);

if (failures > 0) process.exit(1);
