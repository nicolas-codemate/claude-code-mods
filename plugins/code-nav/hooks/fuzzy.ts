// Fuzzy matching in the spirit of an IDE's search: the query's characters appear in the candidate in order, whatever
// their case, and the score says how much the match looks like what the person meant. From most to least it rewards
// an exact match, a prefix, camel-case humps and word starts ("OrRe" for OrderRepository), runs of consecutive
// characters, and for a path matches in the file name rather than in its directories; it prefers shorter candidates
// and fewer directories.

const SCORE_MATCHED_CHARACTER = 16
const BONUS_NAME_START = 12
const BONUS_WORD_START = 9
const BONUS_CAMEL_HUMP = 8
const BONUS_CONSECUTIVE = 5
// Given only to a character typed in upper case: lower case is how a query is typed when the case does not matter.
const BONUS_CASE_MATCH = 2
const BONUS_PREFIX = 30
const BONUS_EXACT = 40
// A gap costs the same whatever its length: the length of the name is counted once, as its unmatched characters.
const PENALTY_GAP = 5
// A character matched inside a word, neither starting it nor continuing a run, is the weakest evidence there is.
const PENALTY_LONE_CHARACTER_INSIDE_WORD = 6
const PENALTY_CHARACTER_MATCHED_IN_DIRECTORIES = 3
const PENALTY_UNMATCHED_NAME_CHARACTER = 1
const PENALTY_DIRECTORY = 1

const UNREACHABLE = -1_000_000

const SLASH = 47
const DOT = 46

const SEPARATOR = 0
const LOWER_CASE_LETTER = 1
const UPPER_CASE_LETTER = 2
const DIGIT = 3

const CHARACTER_CLASS_BY_ASCII_CODE = new Uint8Array(128)
for (let code = 0; code < 128; code++) {
  CHARACTER_CLASS_BY_ASCII_CODE[code] =
    code >= 97 && code <= 122
      ? LOWER_CASE_LETTER
      : code >= 65 && code <= 90
        ? UPPER_CASE_LETTER
        : code >= 48 && code <= 57
          ? DIGIT
          : SEPARATOR
}

function characterClassAt(text: string, index: number): number {
  const code = text.charCodeAt(index)

  return code < 128 ? (CHARACTER_CLASS_BY_ASCII_CODE[code] ?? SEPARATOR) : LOWER_CASE_LETTER
}

export type FuzzyQuery = {
  text: string
  lowerCaseText: string
  // One bit per letter, digit or punctuation mark of the query: a candidate whose own mask lacks one cannot match.
  characterMask: number
  lowerCaseCharacters: readonly string[]
  // The bit of each character in a character mask.
  characterBits: readonly number[]
  // The code of each character typed in upper case, -1 for the others.
  upperCaseCodes: readonly number[]
}

export type FuzzyMatch = { score: number; matchedIndexes: number[] }

const OTHER_CHARACTER_BIT = 1 << 31
const CHARACTER_BIT_BY_ASCII_CODE = new Int32Array(128).fill(OTHER_CHARACTER_BIT)
for (let code = 97; code <= 122; code++) {
  CHARACTER_BIT_BY_ASCII_CODE[code] = 1 << (code - 97)
}
for (let code = 48; code <= 57; code++) {
  CHARACTER_BIT_BY_ASCII_CODE[code] = 1 << 26
}
CHARACTER_BIT_BY_ASCII_CODE[95] = 1 << 27
CHARACTER_BIT_BY_ASCII_CODE[45] = 1 << 28
CHARACTER_BIT_BY_ASCII_CODE[DOT] = 1 << 29
CHARACTER_BIT_BY_ASCII_CODE[SLASH] = 1 << 30

function characterBitAt(lowerCaseText: string, index: number): number {
  const code = lowerCaseText.charCodeAt(index)

  return code < 128 ? (CHARACTER_BIT_BY_ASCII_CODE[code] ?? OTHER_CHARACTER_BIT) : OTHER_CHARACTER_BIT
}

// One bit per letter, one for the digits, one each for "_", "-", "." and "/", one for everything else.
export function characterMaskOf(lowerCaseText: string): number {
  let mask = 0
  for (let index = 0; index < lowerCaseText.length; index++) {
    mask |= characterBitAt(lowerCaseText, index)
  }

  return mask
}

export function prepareFuzzyQuery(text: string): FuzzyQuery {
  const lowerCaseText = text.toLowerCase()
  const hasSameLength = lowerCaseText.length === text.length
  const lowerCaseCharacters = [...Array(lowerCaseText.length).keys()].map(index => lowerCaseText.charAt(index))

  return {
    text,
    lowerCaseText,
    characterMask: characterMaskOf(lowerCaseText),
    lowerCaseCharacters,
    characterBits: lowerCaseCharacters.map(character => characterBitAt(character, 0)),
    upperCaseCodes: lowerCaseCharacters.map((character, index) =>
      hasSameLength && text.charAt(index) !== character ? text.charCodeAt(index) : -1,
    ),
  }
}

// Whether the query's characters appear in the text in order, which is all a match requires.
export function isFuzzySubsequence(query: FuzzyQuery, lowerCaseText: string): boolean {
  let position = 0
  for (const character of query.lowerCaseCharacters) {
    position = lowerCaseText.indexOf(character, position) + 1
    if (position === 0) {
      return false
    }
  }

  return true
}

// The start of the file name in a path: what follows its last slash.
export function fileNameStartOf(path: string): number {
  return path.lastIndexOf('/') + 1
}

function positionBonus(candidate: string, index: number, nameStart: number): number {
  if (index === nameStart) {
    return BONUS_NAME_START
  }
  if (index === 0) {
    return BONUS_WORD_START
  }
  const characterClass = characterClassAt(candidate, index)
  if (characterClass === SEPARATOR) {
    return 0
  }
  const previousClass = characterClassAt(candidate, index - 1)
  if (previousClass === SEPARATOR) {
    return BONUS_WORD_START
  }
  if (characterClass === UPPER_CASE_LETTER) {
    const startsHumpAfterAcronym =
      previousClass === UPPER_CASE_LETTER && characterClassAt(candidate, index + 1) === LOWER_CASE_LETTER

    return previousClass !== UPPER_CASE_LETTER || startsHumpAfterAcronym ? BONUS_CAMEL_HUMP : 0
  }

  return characterClass === DIGIT && previousClass !== DIGIT ? BONUS_CAMEL_HUMP : 0
}

// The alignment of the last candidate scored, kept for reading the matched indexes back. A cell is one place where
// a query character can be matched: its index in the candidate, the best score of an alignment matching it there,
// and the cell of the previous query character that alignment comes from. Cells are stored row after row, one row
// per query character, in the order of the candidate.
let cellCapacity = 1024
let cellPositions = new Int32Array(cellCapacity)
let cellScores = new Int32Array(cellCapacity)
// The bonus of the first character of the run of consecutive matches a cell ends: the whole run inherits it.
let cellRunStartBonuses = new Int8Array(cellCapacity)
let cellPredecessors = new Int32Array(cellCapacity)
let rowCapacity = 64
let firstPositions = new Int32Array(rowCapacity)
let lastPositions = new Int32Array(rowCapacity)

function reserveAlignmentCells(queryLength: number, candidateLength: number): void {
  if (queryLength > rowCapacity) {
    rowCapacity = queryLength * 2
    firstPositions = new Int32Array(rowCapacity)
    lastPositions = new Int32Array(rowCapacity)
  }
  if (queryLength * candidateLength > cellCapacity) {
    cellCapacity = queryLength * candidateLength * 2
    cellPositions = new Int32Array(cellCapacity)
    cellScores = new Int32Array(cellCapacity)
    cellRunStartBonuses = new Int8Array(cellCapacity)
    cellPredecessors = new Int32Array(cellCapacity)
  }
}

// Fills firstPositions and lastPositions: the leftmost and the rightmost place each query character can take in a
// full match. False when the query's characters do not appear in order.
function locateMatchBounds(query: FuzzyQuery, lowerCaseCandidate: string): boolean {
  const queryLength = query.lowerCaseCharacters.length
  let position = 0
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    position = lowerCaseCandidate.indexOf(query.lowerCaseCharacters[queryIndex] ?? '', position)
    if (position === -1) {
      return false
    }
    firstPositions[queryIndex] = position
    position += 1
  }
  position = lowerCaseCandidate.length - 1
  for (let queryIndex = queryLength - 1; queryIndex >= 0; queryIndex--) {
    position = lowerCaseCandidate.lastIndexOf(query.lowerCaseCharacters[queryIndex] ?? '', position)
    lastPositions[queryIndex] = position
    position -= 1
  }

  return true
}

// Fills the cells between the match bounds and returns the cell where the best alignment ends. A cell is reached
// either from the cell matching the previous query character just before it, continuing a run, or from the best of
// the earlier ones, across a gap.
function fillAlignmentCells(query: FuzzyQuery, candidate: string, lowerCaseCandidate: string, nameStart: number): number {
  const positions = cellPositions
  const scores = cellScores
  const runStartBonuses = cellRunStartBonuses
  const predecessors = cellPredecessors
  const queryLength = query.lowerCaseCharacters.length
  let cellCount = 0
  let previousRowStart = 0

  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const character = query.lowerCaseCharacters[queryIndex] ?? ''
    const upperCaseCode = query.upperCaseCodes[queryIndex] ?? -1
    const last = lastPositions[queryIndex] ?? 0
    const rowStart = cellCount
    // The first cell of the previous row a gap does not yet separate from the candidate index being matched.
    let previousCell = previousRowStart
    let bestScoreAcrossGap = UNREACHABLE
    let bestCellAcrossGap = -1

    for (
      let index = firstPositions[queryIndex] ?? 0;
      index !== -1 && index <= last;
      index = index === last ? -1 : lowerCaseCandidate.indexOf(character, index + 1)
    ) {
      while (previousCell < rowStart && (positions[previousCell] ?? 0) <= index - 2) {
        if ((scores[previousCell] ?? 0) >= bestScoreAcrossGap) {
          bestScoreAcrossGap = scores[previousCell] ?? 0
          bestCellAcrossGap = previousCell
        }
        previousCell += 1
      }
      const bonus = positionBonus(candidate, index, nameStart)
      const characterScore =
        SCORE_MATCHED_CHARACTER +
        (candidate.charCodeAt(index) === upperCaseCode ? BONUS_CASE_MATCH : 0) -
        (index < nameStart ? PENALTY_CHARACTER_MATCHED_IN_DIRECTORIES : 0)
      const scoreStartingRun = characterScore + bonus - (bonus === 0 ? PENALTY_LONE_CHARACTER_INSIDE_WORD : 0)
      let score = scoreStartingRun
      let runStartBonus = bonus
      let predecessor = -1
      if (queryIndex > 0) {
        score = bestCellAcrossGap === -1 ? UNREACHABLE : bestScoreAcrossGap - PENALTY_GAP + scoreStartingRun
        predecessor = bestCellAcrossGap
        if (previousCell < rowStart && positions[previousCell] === index - 1) {
          const inheritedBonus = runStartBonuses[previousCell] ?? 0
          const startsItsOwnRun = bonus >= BONUS_CAMEL_HUMP && bonus > inheritedBonus
          const bonusInRun = startsItsOwnRun ? bonus : Math.max(bonus, BONUS_CONSECUTIVE, inheritedBonus)
          const scoreInRun = (scores[previousCell] ?? 0) + characterScore + bonusInRun
          if (scoreInRun >= score) {
            score = scoreInRun
            runStartBonus = startsItsOwnRun ? bonus : inheritedBonus
            predecessor = previousCell
          }
        }
        if (predecessor === -1) {
          continue
        }
      }
      positions[cellCount] = index
      scores[cellCount] = score
      runStartBonuses[cellCount] = runStartBonus
      predecessors[cellCount] = predecessor
      cellCount += 1
    }
    previousRowStart = rowStart
  }

  let bestCell = previousRowStart
  for (let cell = previousRowStart + 1; cell < cellCount; cell++) {
    if ((scores[cell] ?? 0) > (scores[bestCell] ?? 0)) {
      bestCell = cell
    }
  }

  return bestCell
}

function matchedIndexesEndingAt(bestCell: number, queryLength: number): number[] {
  const matchedIndexes = new Array<number>(queryLength)
  let cell = bestCell
  for (let queryIndex = queryLength - 1; queryIndex >= 0; queryIndex--) {
    matchedIndexes[queryIndex] = cellPositions[cell] ?? 0
    cell = cellPredecessors[cell] ?? 0
  }

  return matchedIndexes
}

function isPrefixOfName(query: FuzzyQuery, lowerCaseCandidate: string, nameStart: number): boolean {
  return lowerCaseCandidate.startsWith(query.lowerCaseText, nameStart)
}

// A prefix of the name is its best alignment, every character inheriting the bonus of the name's start: no table.
function prefixScore(query: FuzzyQuery, candidate: string, nameStart: number): number {
  const queryLength = query.lowerCaseCharacters.length
  let score = queryLength * (SCORE_MATCHED_CHARACTER + BONUS_NAME_START) + BONUS_PREFIX
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    if (candidate.charCodeAt(nameStart + queryIndex) === query.upperCaseCodes[queryIndex]) {
      score += BONUS_CASE_MATCH
    }
  }
  const endOfPrefix = nameStart + queryLength
  const isWholeName = endOfPrefix === candidate.length || candidate.charCodeAt(endOfPrefix) === DOT

  return isWholeName ? score + BONUS_EXACT : score
}

// What a name loses for the characters the query leaves unmatched in it: the shorter of two names wins.
export function unmatchedNamePenalty(queryLength: number, nameLength: number): number {
  return Math.max(0, nameLength - queryLength) * PENALTY_UNMATCHED_NAME_CHARACTER
}

function candidateShapePenalty(queryLength: number, candidate: string, nameStart: number): number {
  let penalty = unmatchedNamePenalty(queryLength, candidate.length - nameStart)
  for (let index = 0; index < nameStart; index++) {
    if (candidate.charCodeAt(index) === SLASH) {
      penalty += PENALTY_DIRECTORY
    }
  }

  return penalty
}

// The highest score a name can reach, before unmatchedNamePenalty: the query starts it, case included, and is the
// whole of it when isWholeName.
export function highestFuzzyScore(query: FuzzyQuery, isWholeName: boolean): number {
  const highestCharacterScore = SCORE_MATCHED_CHARACTER + BONUS_NAME_START + BONUS_CASE_MATCH

  return query.lowerCaseCharacters.length * highestCharacterScore + BONUS_PREFIX + (isWholeName ? BONUS_EXACT : 0)
}

// The mask of the characters that start a word in a name: those a query matches with a bonus.
export function wordStartCharacterMaskOf(name: string, lowerCaseName: string): number {
  let mask = 0
  for (let index = 0; index < name.length; index++) {
    if (positionBonus(name, index, 0) > 0) {
      mask |= characterBitAt(lowerCaseName, index)
    }
  }

  return mask
}

const HIGHEST_SCORE_IN_RUN_FROM_WORD_START = SCORE_MATCHED_CHARACTER + BONUS_WORD_START + BONUS_CASE_MATCH
const HIGHEST_SCORE_IN_RUN_FROM_INSIDE_WORD = SCORE_MATCHED_CHARACTER + BONUS_CONSECUTIVE + BONUS_CASE_MATCH
const HIGHEST_SCORE_OF_LONE_CHARACTER = SCORE_MATCHED_CHARACTER - PENALTY_LONE_CHARACTER_INSIDE_WORD + BONUS_CASE_MATCH

// The ceiling of the score of a plain name, before unmatchedNamePenalty, when the query is not a prefix of it,
// from the characters starting a word in the name alone (wordStartCharacterMaskOf). A query character scores high
// only at a word start or in a run begun at one; any other starts or continues a run begun inside a word. Runs are
// taken to be possible wherever the masks allow, hence a ceiling: a caller already holding better rows skips the
// name without aligning it.
export function highestFuzzyScoreWithoutPrefix(query: FuzzyQuery, wordStartMask: number, startsWithFirstCharacter: boolean): number {
  const queryLength = query.characterBits.length
  if (queryLength === 0) {
    return 0
  }
  let scoreInRunFromWordStart = UNREACHABLE
  let scoreInRunFromInsideWord = UNREACHABLE
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const bestScore = Math.max(scoreInRunFromWordStart, scoreInRunFromInsideWord)
    const scoreAfterGap = queryIndex === 0 ? 0 : bestScore - PENALTY_GAP
    const canStartWord = (wordStartMask & (query.characterBits[queryIndex] ?? 0)) !== 0
    const scoreBeforeRunFromWordStart = canStartWord ? Math.max(bestScore, scoreAfterGap) : scoreInRunFromWordStart
    scoreInRunFromInsideWord = Math.max(
      scoreInRunFromInsideWord + HIGHEST_SCORE_IN_RUN_FROM_INSIDE_WORD,
      scoreAfterGap + HIGHEST_SCORE_OF_LONE_CHARACTER,
    )
    scoreInRunFromWordStart = scoreBeforeRunFromWordStart + HIGHEST_SCORE_IN_RUN_FROM_WORD_START
  }
  // A run begun at the very start of the name earns more than one begun at another word.
  const bonusOfNameStart = startsWithFirstCharacter ? queryLength * (BONUS_NAME_START - BONUS_WORD_START) : 0

  return Math.max(scoreInRunFromWordStart, scoreInRunFromInsideWord) + bonusOfNameStart
}

// The score of the query against a candidate, null when the query's characters do not appear in it in order.
// nameStart is where the candidate's name starts: 0 for a plain name, the start of the file name for a path.
// A name is matched exactly when the query covers it whole or up to its first dot ("order" for order.service.ts).
export function fuzzyScore(query: FuzzyQuery, candidate: string, lowerCaseCandidate: string, nameStart: number): number | null {
  const queryLength = query.lowerCaseCharacters.length
  if (queryLength === 0) {
    return 0
  }
  if (queryLength > lowerCaseCandidate.length) {
    return null
  }
  if (isPrefixOfName(query, lowerCaseCandidate, nameStart)) {
    return prefixScore(query, candidate, nameStart) - candidateShapePenalty(queryLength, candidate, nameStart)
  }
  reserveAlignmentCells(queryLength, lowerCaseCandidate.length)
  if (!locateMatchBounds(query, lowerCaseCandidate)) {
    return null
  }
  const bestCell = fillAlignmentCells(query, candidate, lowerCaseCandidate, nameStart)

  return (cellScores[bestCell] ?? 0) - candidateShapePenalty(queryLength, candidate, nameStart)
}

// The indexes of the candidate's characters the best alignment matches, in order; empty when there is no match.
export function fuzzyMatchedIndexes(query: FuzzyQuery, candidate: string, lowerCaseCandidate: string, nameStart: number): number[] {
  const queryLength = query.lowerCaseCharacters.length
  if (queryLength === 0 || queryLength > lowerCaseCandidate.length) {
    return []
  }
  if (isPrefixOfName(query, lowerCaseCandidate, nameStart)) {
    return [...Array(queryLength).keys()].map(queryIndex => nameStart + queryIndex)
  }
  reserveAlignmentCells(queryLength, lowerCaseCandidate.length)
  if (!locateMatchBounds(query, lowerCaseCandidate)) {
    return []
  }

  return matchedIndexesEndingAt(fillAlignmentCells(query, candidate, lowerCaseCandidate, nameStart), queryLength)
}

function fuzzyMatchFrom(queryText: string, candidate: string, nameStart: number): FuzzyMatch | null {
  const query = prepareFuzzyQuery(queryText)
  const lowerCaseCandidate = candidate.toLowerCase()
  const score = fuzzyScore(query, candidate, lowerCaseCandidate, nameStart)

  return score === null ? null : { score, matchedIndexes: fuzzyMatchedIndexes(query, candidate, lowerCaseCandidate, nameStart) }
}

// Matches a query against a plain name: a class, a method, a file's base name.
export function fuzzyMatch(queryText: string, name: string): FuzzyMatch | null {
  return fuzzyMatchFrom(queryText, name, 0)
}

// Matches a query against a whole path, its file name weighing more than its directories.
export function fuzzyMatchPath(queryText: string, path: string): FuzzyMatch | null {
  return fuzzyMatchFrom(queryText, path, fileNameStartOf(path))
}
