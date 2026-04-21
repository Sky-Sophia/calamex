export type TGitLineChangeType = 'added' | 'modified' | 'deleted';

export interface IGitLineChange {
  type: TGitLineChangeType;
  startLine: number;
  endLine: number;
}

type TDiffOperation = 'equal' | 'insert' | 'delete';

const MAX_DIFF_MATRIX_CELLS = 1_200_000;

const splitLines = (content: string): string[] => (content.length === 0 ? [] : content.split('\n'));

const clampLineNumber = (lineNumber: number, currentLineCount: number): number => {
  if (currentLineCount <= 0) {
    return 1;
  }

  return Math.min(Math.max(1, lineNumber), currentLineCount);
};

const mergeAdjacentChanges = (changes: IGitLineChange[]): IGitLineChange[] => {
  if (changes.length <= 1) {
    return changes;
  }

  const merged: IGitLineChange[] = [];

  for (const change of changes) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.type === change.type &&
      change.startLine <= previous.endLine + 1
    ) {
      previous.endLine = Math.max(previous.endLine, change.endLine);
      continue;
    }

    merged.push({ ...change });
  }

  return merged;
};

const appendRange = (
  changes: IGitLineChange[],
  type: TGitLineChangeType,
  startLine: number,
  endLine: number,
): void => {
  if (startLine > endLine) {
    return;
  }

  changes.push({
    type,
    startLine,
    endLine,
  });
};

const buildLcsMatrix = (baselineLines: string[], currentLines: string[]): Uint32Array[] => {
  const baselineLength = baselineLines.length;
  const currentLength = currentLines.length;
  const matrix = Array.from({ length: baselineLength + 1 }, () => new Uint32Array(currentLength + 1));

  for (let baselineIndex = baselineLength - 1; baselineIndex >= 0; baselineIndex -= 1) {
    for (let currentIndex = currentLength - 1; currentIndex >= 0; currentIndex -= 1) {
      if (baselineLines[baselineIndex] === currentLines[currentIndex]) {
        matrix[baselineIndex][currentIndex] = matrix[baselineIndex + 1][currentIndex + 1] + 1;
        continue;
      }

      matrix[baselineIndex][currentIndex] = Math.max(
        matrix[baselineIndex + 1][currentIndex],
        matrix[baselineIndex][currentIndex + 1],
      );
    }
  }

  return matrix;
};

const buildDiffOperations = (
  baselineLines: string[],
  currentLines: string[],
  matrix: Uint32Array[],
): TDiffOperation[] => {
  const operations: TDiffOperation[] = [];
  let baselineIndex = 0;
  let currentIndex = 0;

  while (baselineIndex < baselineLines.length || currentIndex < currentLines.length) {
    if (
      baselineIndex < baselineLines.length &&
      currentIndex < currentLines.length &&
      baselineLines[baselineIndex] === currentLines[currentIndex]
    ) {
      operations.push('equal');
      baselineIndex += 1;
      currentIndex += 1;
      continue;
    }

    const deleteScore =
      baselineIndex < baselineLines.length ? matrix[baselineIndex + 1][currentIndex] : -1;
    const insertScore =
      currentIndex < currentLines.length ? matrix[baselineIndex][currentIndex + 1] : -1;

    if (currentIndex < currentLines.length && (baselineIndex >= baselineLines.length || insertScore >= deleteScore)) {
      operations.push('insert');
      currentIndex += 1;
      continue;
    }

    operations.push('delete');
    baselineIndex += 1;
  }

  return operations;
};

const buildChangesFromOperations = (
  operations: TDiffOperation[],
  prefixLineCount: number,
  currentLineCount: number,
): IGitLineChange[] => {
  const changes: IGitLineChange[] = [];
  let currentLine = prefixLineCount + 1;
  let chunkStartLine = currentLine;
  let deletedCount = 0;
  let insertedCount = 0;

  const flushChunk = (): void => {
    if (deletedCount === 0 && insertedCount === 0) {
      return;
    }

    if (deletedCount === 0) {
      appendRange(changes, 'added', chunkStartLine, chunkStartLine + insertedCount - 1);
    } else if (insertedCount === 0) {
      const anchorLine = clampLineNumber(chunkStartLine, currentLineCount);
      appendRange(changes, 'deleted', anchorLine, anchorLine);
    } else {
      const modifiedCount = Math.min(deletedCount, insertedCount);
      appendRange(changes, 'modified', chunkStartLine, chunkStartLine + modifiedCount - 1);

      if (insertedCount > modifiedCount) {
        appendRange(
          changes,
          'added',
          chunkStartLine + modifiedCount,
          chunkStartLine + insertedCount - 1,
        );
      }

      if (deletedCount > modifiedCount) {
        const anchorLine = clampLineNumber(chunkStartLine + modifiedCount, currentLineCount);
        appendRange(changes, 'deleted', anchorLine, anchorLine);
      }
    }

    deletedCount = 0;
    insertedCount = 0;
  };

  for (const operation of operations) {
    if (operation === 'equal') {
      flushChunk();
      currentLine += 1;
      continue;
    }

    if (deletedCount === 0 && insertedCount === 0) {
      chunkStartLine = currentLine;
    }

    if (operation === 'insert') {
      insertedCount += 1;
      currentLine += 1;
      continue;
    }

    deletedCount += 1;
  }

  flushChunk();

  return mergeAdjacentChanges(changes);
};

export const computeGitLineChanges = (
  baselineContent: string,
  currentContent: string,
): IGitLineChange[] => {
  if (baselineContent === currentContent) {
    return [];
  }

  const baselineLines = splitLines(baselineContent);
  const currentLines = splitLines(currentContent);

  if (baselineLines.length === 0) {
    return currentLines.length === 0
      ? []
      : [{ type: 'added', startLine: 1, endLine: currentLines.length }];
  }

  if (currentLines.length === 0) {
    return [{ type: 'deleted', startLine: 1, endLine: 1 }];
  }

  let prefixLineCount = 0;
  while (
    prefixLineCount < baselineLines.length &&
    prefixLineCount < currentLines.length &&
    baselineLines[prefixLineCount] === currentLines[prefixLineCount]
  ) {
    prefixLineCount += 1;
  }

  let baselineSuffixIndex = baselineLines.length - 1;
  let currentSuffixIndex = currentLines.length - 1;

  while (
    baselineSuffixIndex >= prefixLineCount &&
    currentSuffixIndex >= prefixLineCount &&
    baselineLines[baselineSuffixIndex] === currentLines[currentSuffixIndex]
  ) {
    baselineSuffixIndex -= 1;
    currentSuffixIndex -= 1;
  }

  const middleBaselineLines = baselineLines.slice(prefixLineCount, baselineSuffixIndex + 1);
  const middleCurrentLines = currentLines.slice(prefixLineCount, currentSuffixIndex + 1);

  if (middleBaselineLines.length === 0) {
    return mergeAdjacentChanges([
      {
        type: 'added',
        startLine: prefixLineCount + 1,
        endLine: prefixLineCount + middleCurrentLines.length,
      },
    ]);
  }

  if (middleCurrentLines.length === 0) {
    const anchorLine = clampLineNumber(prefixLineCount + 1, currentLines.length);
    return [{ type: 'deleted', startLine: anchorLine, endLine: anchorLine }];
  }

  if (middleBaselineLines.length * middleCurrentLines.length > MAX_DIFF_MATRIX_CELLS) {
    return [{ type: 'modified', startLine: 1, endLine: currentLines.length }];
  }

  const matrix = buildLcsMatrix(middleBaselineLines, middleCurrentLines);
  const operations = buildDiffOperations(middleBaselineLines, middleCurrentLines, matrix);

  return buildChangesFromOperations(operations, prefixLineCount, currentLines.length);
};
