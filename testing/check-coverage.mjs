/**
 * ABOUTME: Merges LCOV batch outputs and checks an equal-weight per-file line coverage threshold.
 * This avoids skew from using only the first coverage batch or raw line totals from very large files.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [, , coverageDir = 'coverage-parts', thresholdArg = '38'] = process.argv;
const threshold = Number.parseFloat(thresholdArg);

if (!Number.isFinite(threshold)) {
  console.error(`Invalid coverage threshold: ${thresholdArg}`);
  process.exit(1);
}

/**
 * @param {string} line
 * @returns {{ lineNumber: number, hits: number } | null}
 */
function parseCoverageLine(line) {
  if (!line.startsWith('DA:')) {
    return null;
  }

  const [lineNumberText, hitsText] = line.slice(3).split(',', 2);
  const lineNumber = Number.parseInt(lineNumberText ?? '', 10);
  const hits = Number.parseInt(hitsText ?? '', 10);

  if (!Number.isInteger(lineNumber) || !Number.isInteger(hits)) {
    return null;
  }

  return { lineNumber, hits };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function getLcovFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.lcov'))
    .map((entry) => join(dir, entry.name))
    .sort();
}

/**
 * @param {string[]} lcovFiles
 * @returns {Promise<Map<string, Map<number, number>>>}
 */
async function mergeCoverage(lcovFiles) {
  const merged = new Map();

  for (const lcovFile of lcovFiles) {
    const content = await readFile(lcovFile, 'utf8');
    let currentSourceFile;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();

      if (line.startsWith('SF:')) {
        currentSourceFile = line.slice(3);
        if (!merged.has(currentSourceFile)) {
          merged.set(currentSourceFile, new Map());
        }
        continue;
      }

      if (line === 'end_of_record') {
        currentSourceFile = undefined;
        continue;
      }

      if (!currentSourceFile) {
        continue;
      }

      const parsedCoverageLine = parseCoverageLine(line);
      if (!parsedCoverageLine) {
        continue;
      }

      const fileCoverage = merged.get(currentSourceFile);
      if (!fileCoverage) {
        continue;
      }

      const previousHits = fileCoverage.get(parsedCoverageLine.lineNumber) ?? 0;
      fileCoverage.set(parsedCoverageLine.lineNumber, Math.max(previousHits, parsedCoverageLine.hits));
    }
  }

  return merged;
}

try {
  const lcovFiles = await getLcovFiles(coverageDir);
  if (lcovFiles.length === 0) {
    console.error(`No LCOV files found in ${coverageDir}`);
    process.exit(1);
  }

  const mergedCoverage = await mergeCoverage(lcovFiles);
  const perFileLineCoverage = [];

  for (const [sourceFile, coveredLines] of mergedCoverage.entries()) {
    const totalLines = coveredLines.size;
    if (totalLines === 0) {
      continue;
    }

    let hitLines = 0;
    for (const hits of coveredLines.values()) {
      if (hits > 0) {
        hitLines += 1;
      }
    }

    perFileLineCoverage.push({
      sourceFile,
      lineCoverage: (hitLines / totalLines) * 100,
    });
  }

  if (perFileLineCoverage.length === 0) {
    console.error('No instrumented source files were found in the merged LCOV data');
    process.exit(1);
  }

  const averageLineCoverage = perFileLineCoverage
    .reduce((sum, fileCoverage) => sum + fileCoverage.lineCoverage, 0) / perFileLineCoverage.length;

  console.log(
    `Combined per-file line coverage: ${averageLineCoverage.toFixed(2)}% ` +
    `across ${perFileLineCoverage.length} files from ${lcovFiles.length} LCOV batches`
  );

  if (averageLineCoverage < threshold) {
    console.error(`❌ Combined per-file line coverage ${averageLineCoverage.toFixed(2)}% is below ${threshold}% threshold`);
    process.exit(1);
  }

  console.log(`✅ Combined per-file line coverage ${averageLineCoverage.toFixed(2)}% meets ${threshold}% threshold`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to check coverage: ${message}`);
  process.exit(1);
}
