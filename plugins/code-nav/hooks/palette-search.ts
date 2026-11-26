import { isClassLikeKind } from './symbol-names'
import type { PaletteItem, SymbolEntry, SymbolKind } from '../types'
import type { FuzzyQuery } from './fuzzy'
import {
  characterMaskOf,
  fileNameStartOf,
  fuzzyMatchedIndexes,
  fuzzyScore,
  highestFuzzyScore,
  highestFuzzyScoreWithoutPrefix,
  isFuzzySubsequence,
  prepareFuzzyQuery,
  unmatchedNamePenalty,
  wordStartCharacterMaskOf,
} from './fuzzy'

// What breaks a tie between rows the query matches equally well: a class-like above the file declaring it, then
// functions and methods, then the rest.
const RANKING_BONUS_BY_SYMBOL_KIND: Record<SymbolKind, number> = {
  class: 8,
  interface: 8,
  trait: 8,
  enum: 8,
  type: 6,
  function: 4,
  method: 4,
  constant: 2,
  property: 0,
  variable: 0,
  section: 0,
}
const RANKING_BONUS_OF_FILE = 6
const HIGHEST_RANKING_BONUS_OF_A_KIND = Math.max(RANKING_BONUS_OF_FILE, ...Object.values(RANKING_BONUS_BY_SYMBOL_KIND))
const RANKING_BONUS_OF_MOST_RECENT_FILE = 8
const RANKING_BONUS_OF_ANY_RECENT_FILE = 4
const RANKING_PENALTY_OF_TESTS_AND_FIXTURES = 3
const RANKING_PENALTY_PER_DIRECTORY = 1
// A part of a path query found in a directory's name weighs less than the same part found in the file's name.
const RANKING_PENALTY_OF_FILE_NAME_LEFT_UNMATCHED = 20

const TESTS_OR_FIXTURES_DIRECTORY = /(?:^|\/)(?:tests?|__tests__|specs?|(?:data)?fixtures?|__fixtures__)\//i
const CONTAINER_SEPARATOR = '::'
const DOT_MASK = characterMaskOf('.')
const EVERY_CHARACTER_MASK = -1
const FIRST_LINE = 1
const NO_MATCH = -(2 ** 30)
const NOT_SCORED_YET = NO_MATCH + 1

// Distinct names with what a query needs of each. A name borne by three thousand methods is scored once.
type NameTable = {
  names: string[]
  lowerCaseNames: string[]
  characterMasks: Int32Array
  // The characters starting a word in each name, 0 until a query first needs them: reading every name's words
  // would weigh on each index build for names most queries never reach.
  wordStartMasks: Int32Array
  // A name with a dot is matched exactly by what stands before the dot, however long the name: "order.service.ts".
  isAnyNameHoldingDot: boolean
}

// The rows carrying each name of a table: those of name n are rows[starts[n]] to rows[starts[n + 1] - 1].
type RowsByName = { starts: Int32Array; rows: Int32Array }

export type PaletteSource = {
  files: readonly string[]
  symbols: readonly SymbolEntry[]
  fileIndexByPath: ReadonlyMap<string, number>

  // The base names of the files, the shortest first.
  fileNames: NameTable
  filesByName: RowsByName
  nameOfFile: Int32Array
  fileRankingBonuses: Int8Array
  highestFileRankingBonusByName: Int8Array
  // 1 for a file named after a class-like it declares: Order.php declaring Order.
  isFileNamedAfterItsClassLike: Uint8Array

  directoryOfFile: Int32Array
  directoryDepths: Int32Array
  // The names directories are made of ("src", "Order"), and for each directory its names from the root down.
  directoryNames: NameTable
  namesAlongDirectory: RowsByName

  // The names of the symbols and of their containers, the shortest first.
  symbolNames: NameTable
  symbolsByName: RowsByName
  membersByContainerName: RowsByName
  nameOfSymbol: Int32Array
  // -1 for a symbol without a container.
  containerNameOfSymbol: Int32Array
  // -1 when the file list does not hold the symbol's path.
  fileOfSymbol: Int32Array
  symbolRankingBonuses: Int8Array
  highestSymbolRankingBonusByName: Int8Array
}

export type PaletteContext = { recentPaths: readonly string[]; currentPath: string | null }

function internName(idByName: Map<string, number>, names: string[], name: string): number {
  let id = idByName.get(name)
  if (id === undefined) {
    id = names.length
    idByName.set(name, id)
    names.push(name)
  }

  return id
}

// The place of each name once the names are ordered by length, names of one length keeping their order.
function placesByLength(names: readonly string[]): Int32Array {
  let longestLength = 0
  for (const name of names) {
    longestLength = Math.max(longestLength, name.length)
  }
  const nextPlaceByLength = new Int32Array(longestLength + 2)
  for (const name of names) {
    nextPlaceByLength[name.length + 1] = (nextPlaceByLength[name.length + 1] ?? 0) + 1
  }
  for (let length = 1; length < nextPlaceByLength.length; length++) {
    nextPlaceByLength[length] = (nextPlaceByLength[length] ?? 0) + (nextPlaceByLength[length - 1] ?? 0)
  }
  const places = new Int32Array(names.length)
  for (let id = 0; id < names.length; id++) {
    const length = (names[id] ?? '').length
    places[id] = nextPlaceByLength[length] ?? 0
    nextPlaceByLength[length] = (places[id] ?? 0) + 1
  }

  return places
}

function nameTableOf(names: string[]): NameTable {
  const lowerCaseNames = new Array<string>(names.length)
  const characterMasks = new Int32Array(names.length)
  for (let name = 0; name < names.length; name++) {
    const lowerCaseName = (names[name] ?? '').toLowerCase()
    lowerCaseNames[name] = lowerCaseName
    characterMasks[name] = characterMaskOf(lowerCaseName)
  }

  return {
    names,
    lowerCaseNames,
    characterMasks,
    wordStartMasks: new Int32Array(names.length),
    isAnyNameHoldingDot: characterMasks.some(characterMask => (characterMask & DOT_MASK) !== 0),
  }
}

function nameTableShortestFirst(names: readonly string[], places: Int32Array): NameTable {
  const namesInPlace = new Array<string>(names.length)
  for (let id = 0; id < names.length; id++) {
    namesInPlace[places[id] ?? 0] = names[id] ?? ''
  }

  return nameTableOf(namesInPlace)
}

function rowsByName(nameOfRow: Int32Array, nameCount: number): RowsByName {
  const starts = new Int32Array(nameCount + 1)
  for (let row = 0; row < nameOfRow.length; row++) {
    const name = nameOfRow[row] ?? -1
    if (name !== -1) {
      starts[name + 1] = (starts[name + 1] ?? 0) + 1
    }
  }
  for (let name = 0; name < nameCount; name++) {
    starts[name + 1] = (starts[name + 1] ?? 0) + (starts[name] ?? 0)
  }
  const nextSlots = starts.slice(0, nameCount)
  const rows = new Int32Array(starts[nameCount] ?? 0)
  for (let row = 0; row < nameOfRow.length; row++) {
    const name = nameOfRow[row] ?? -1
    if (name !== -1) {
      rows[nextSlots[name] ?? 0] = row
      nextSlots[name] = (nextSlots[name] ?? 0) + 1
    }
  }

  return { starts, rows }
}

function highestBonusByName(nameOfRow: Int32Array, bonuses: Int8Array, nameCount: number): Int8Array {
  const highestBonuses = new Int8Array(nameCount).fill(-128)
  for (let row = 0; row < nameOfRow.length; row++) {
    const name = nameOfRow[row] ?? 0
    if ((bonuses[row] ?? 0) > (highestBonuses[name] ?? 0)) {
      highestBonuses[name] = bonuses[row] ?? 0
    }
  }

  return highestBonuses
}

function isBaseNameWithoutExtension(path: string, name: string): boolean {
  const nameStart = fileNameStartOf(path)

  return path.lastIndexOf('.') === nameStart + name.length && path.startsWith(name, nameStart)
}

type PreparedFiles = Pick<
  PaletteSource,
  | 'fileIndexByPath'
  | 'fileNames'
  | 'filesByName'
  | 'nameOfFile'
  | 'fileRankingBonuses'
  | 'highestFileRankingBonusByName'
  | 'directoryOfFile'
  | 'directoryDepths'
  | 'directoryNames'
  | 'namesAlongDirectory'
>

function prepareFiles(files: readonly string[]): { prepared: PreparedFiles; isInTestsOrFixtures: Uint8Array } {
  const fileIndexByPath = new Map<string, number>()
  const fileNameIds = new Map<string, number>()
  const distinctFileNames: string[] = []
  const nameOfFile = new Int32Array(files.length)
  const fileRankingBonuses = new Int8Array(files.length)
  const isInTestsOrFixtures = new Uint8Array(files.length)

  const directoryIds = new Map<string, number>()
  const directoryNameIds = new Map<string, number>()
  const distinctDirectoryNames: string[] = []
  const directoryOfFile = new Int32Array(files.length)
  const directoryDepths: number[] = []
  const isDirectoryInTestsOrFixtures: boolean[] = []
  const directoryNameStarts: number[] = [0]
  const directoryNameRows: number[] = []
  let previousDirectory = ''
  let previousDirectoryId = -1

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const path = files[fileIndex] ?? ''
    fileIndexByPath.set(path, fileIndex)
    const nameStart = fileNameStartOf(path)
    nameOfFile[fileIndex] = internName(fileNameIds, distinctFileNames, path.slice(nameStart))
    const directoryLength = Math.max(0, nameStart - 1)
    // Files of one directory mostly follow each other: the directory is looked up only when it changes.
    if (previousDirectoryId === -1 || directoryLength !== previousDirectory.length || !path.startsWith(previousDirectory)) {
      previousDirectory = path.slice(0, directoryLength)
      const knownDirectoryId = directoryIds.get(previousDirectory)
      if (knownDirectoryId === undefined) {
        previousDirectoryId = directoryIds.size
        directoryIds.set(previousDirectory, previousDirectoryId)
        const namesAlong = previousDirectory === '' ? [] : previousDirectory.split('/')
        for (const directoryName of namesAlong) {
          directoryNameRows.push(internName(directoryNameIds, distinctDirectoryNames, directoryName))
        }
        directoryNameStarts.push(directoryNameRows.length)
        directoryDepths.push(namesAlong.length)
        isDirectoryInTestsOrFixtures.push(TESTS_OR_FIXTURES_DIRECTORY.test(`${previousDirectory}/`))
      } else {
        previousDirectoryId = knownDirectoryId
      }
    }
    directoryOfFile[fileIndex] = previousDirectoryId
    if (isDirectoryInTestsOrFixtures[previousDirectoryId]) {
      isInTestsOrFixtures[fileIndex] = 1
      fileRankingBonuses[fileIndex] = RANKING_BONUS_OF_FILE - RANKING_PENALTY_OF_TESTS_AND_FIXTURES
    } else {
      fileRankingBonuses[fileIndex] = RANKING_BONUS_OF_FILE
    }
  }

  const fileNamePlaces = placesByLength(distinctFileNames)
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    nameOfFile[fileIndex] = fileNamePlaces[nameOfFile[fileIndex] ?? 0] ?? 0
  }

  return {
    prepared: {
      fileIndexByPath,
      fileNames: nameTableShortestFirst(distinctFileNames, fileNamePlaces),
      filesByName: rowsByName(nameOfFile, distinctFileNames.length),
      nameOfFile,
      fileRankingBonuses,
      highestFileRankingBonusByName: highestBonusByName(nameOfFile, fileRankingBonuses, distinctFileNames.length),
      directoryOfFile,
      directoryDepths: Int32Array.from(directoryDepths),
      directoryNames: nameTableOf(distinctDirectoryNames),
      namesAlongDirectory: { starts: Int32Array.from(directoryNameStarts), rows: Int32Array.from(directoryNameRows) },
    },
    isInTestsOrFixtures,
  }
}

// Prepared once per index build: the distinct names in lower case with their character masks, the shortest first,
// and which rows carry each, so that a query rejects most names with one comparison, scores each of the others once
// and stops at the names too long to rank.
export function preparePaletteSource(files: readonly string[], symbols: readonly SymbolEntry[]): PaletteSource {
  const { prepared: preparedFiles, isInTestsOrFixtures } = prepareFiles(files)

  const symbolNameIds = new Map<string, number>()
  const distinctSymbolNames: string[] = []
  const nameOfSymbol = new Int32Array(symbols.length)
  const containerNameOfSymbol = new Int32Array(symbols.length)
  const fileOfSymbol = new Int32Array(symbols.length)
  const symbolRankingBonuses = new Int8Array(symbols.length)
  const isFileNamedAfterItsClassLike = new Uint8Array(files.length)
  let previousPath: string | null = null
  let previousFileIndex = -1
  let isPreviousPathInTestsOrFixtures = false
  let previousContainer: string | null = null
  let previousContainerId = -1

  // The symbols of one file follow each other, and so do the members of one container: both are looked up only when
  // they change.
  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex++) {
    const symbol = symbols[symbolIndex]
    if (!symbol) {
      continue
    }
    if (symbol.path !== previousPath) {
      previousPath = symbol.path
      previousFileIndex = preparedFiles.fileIndexByPath.get(symbol.path) ?? -1
      isPreviousPathInTestsOrFixtures =
        previousFileIndex === -1 ? TESTS_OR_FIXTURES_DIRECTORY.test(symbol.path) : isInTestsOrFixtures[previousFileIndex] === 1
    }
    if (symbol.container !== previousContainer) {
      previousContainer = symbol.container
      previousContainerId = symbol.container === null ? -1 : internName(symbolNameIds, distinctSymbolNames, symbol.container)
    }
    nameOfSymbol[symbolIndex] = internName(symbolNameIds, distinctSymbolNames, symbol.name)
    containerNameOfSymbol[symbolIndex] = previousContainerId
    fileOfSymbol[symbolIndex] = previousFileIndex
    symbolRankingBonuses[symbolIndex] =
      RANKING_BONUS_BY_SYMBOL_KIND[symbol.kind] - (isPreviousPathInTestsOrFixtures ? RANKING_PENALTY_OF_TESTS_AND_FIXTURES : 0)
    if (previousFileIndex !== -1 && isClassLikeKind(symbol.kind) && isBaseNameWithoutExtension(symbol.path, symbol.name)) {
      isFileNamedAfterItsClassLike[previousFileIndex] = 1
    }
  }

  const symbolNamePlaces = placesByLength(distinctSymbolNames)
  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex++) {
    nameOfSymbol[symbolIndex] = symbolNamePlaces[nameOfSymbol[symbolIndex] ?? 0] ?? 0
    const containerName = containerNameOfSymbol[symbolIndex] ?? -1
    containerNameOfSymbol[symbolIndex] = containerName === -1 ? -1 : (symbolNamePlaces[containerName] ?? 0)
  }

  return {
    files,
    symbols,
    ...preparedFiles,
    isFileNamedAfterItsClassLike,
    symbolNames: nameTableShortestFirst(distinctSymbolNames, symbolNamePlaces),
    symbolsByName: rowsByName(nameOfSymbol, distinctSymbolNames.length),
    membersByContainerName: rowsByName(containerNameOfSymbol, distinctSymbolNames.length),
    nameOfSymbol,
    containerNameOfSymbol,
    fileOfSymbol,
    symbolRankingBonuses,
    highestSymbolRankingBonusByName: highestBonusByName(nameOfSymbol, symbolRankingBonuses, distinctSymbolNames.length),
  }
}

// The best rows seen so far, at most limit of them, without sorting the others: a heap whose root is the worst row
// kept. A row is a file (its index) or a symbol (the file count plus its index); equal scores are settled by path
// then line, so that two index builds listing the files in another order rank alike.
type TopRows = {
  limit: number
  count: number
  scores: Int32Array
  rows: Int32Array
  source: PaletteSource
}

function createTopRows(limit: number, source: PaletteSource): TopRows {
  return { limit, count: 0, scores: new Int32Array(limit), rows: new Int32Array(limit), source }
}

function isRowBefore(source: PaletteSource, firstRow: number, secondRow: number): boolean {
  const firstSymbol = source.symbols[firstRow - source.files.length]
  const secondSymbol = source.symbols[secondRow - source.files.length]
  const firstPath = firstSymbol?.path ?? source.files[firstRow] ?? ''
  const secondPath = secondSymbol?.path ?? source.files[secondRow] ?? ''
  if (firstPath !== secondPath) {
    return firstPath < secondPath
  }

  return (firstSymbol?.line ?? 0) < (secondSymbol?.line ?? 0)
}

function ranksAbove(top: TopRows, firstScore: number, firstRow: number, secondScore: number, secondRow: number): boolean {
  return firstScore !== secondScore ? firstScore > secondScore : isRowBefore(top.source, firstRow, secondRow)
}

// The score under which a row cannot enter the selection any more.
function scoreToEnter(top: TopRows): number {
  return top.count < top.limit ? NO_MATCH : (top.scores[0] ?? 0)
}

function offerRow(top: TopRows, score: number, row: number): void {
  const { scores, rows } = top
  if (top.count < top.limit) {
    let slot = top.count
    top.count += 1
    while (slot > 0) {
      const parent = (slot - 1) >> 1
      if (!ranksAbove(top, scores[parent] ?? 0, rows[parent] ?? 0, score, row)) {
        break
      }
      scores[slot] = scores[parent] ?? 0
      rows[slot] = rows[parent] ?? 0
      slot = parent
    }
    scores[slot] = score
    rows[slot] = row

    return
  }
  if (score < (scores[0] ?? 0) || !ranksAbove(top, score, row, scores[0] ?? 0, rows[0] ?? 0)) {
    return
  }
  let slot = 0
  for (;;) {
    const leftChild = slot * 2 + 1
    const rightChild = leftChild + 1
    if (leftChild >= top.count) {
      break
    }
    const isRightChildWorse =
      rightChild < top.count &&
      ranksAbove(top, scores[leftChild] ?? 0, rows[leftChild] ?? 0, scores[rightChild] ?? 0, rows[rightChild] ?? 0)
    const worseChild = isRightChildWorse ? rightChild : leftChild
    if (!ranksAbove(top, score, row, scores[worseChild] ?? 0, rows[worseChild] ?? 0)) {
      break
    }
    scores[slot] = scores[worseChild] ?? 0
    rows[slot] = rows[worseChild] ?? 0
    slot = worseChild
  }
  scores[slot] = score
  rows[slot] = row
}

function rankedRows(top: TopRows): number[] {
  const slots = [...Array(top.count).keys()].sort((first, second) =>
    ranksAbove(top, top.scores[first] ?? 0, top.rows[first] ?? 0, top.scores[second] ?? 0, top.rows[second] ?? 0) ? -1 : 1,
  )

  return slots.map(slot => top.rows[slot] ?? 0)
}

type RecentFiles = { bonusByFileIndex: Map<number, number>; highestBonus: number }

function recentFilesOf(source: PaletteSource, recentPaths: readonly string[]): RecentFiles {
  const bonusByFileIndex = new Map<number, number>()
  for (const path of recentPaths) {
    const fileIndex = source.fileIndexByPath.get(path)
    if (fileIndex !== undefined && !bonusByFileIndex.has(fileIndex)) {
      const rank = bonusByFileIndex.size
      bonusByFileIndex.set(fileIndex, Math.max(RANKING_BONUS_OF_ANY_RECENT_FILE, RANKING_BONUS_OF_MOST_RECENT_FILE - rank))
    }
  }

  return { bonusByFileIndex, highestBonus: bonusByFileIndex.size === 0 ? 0 : RANKING_BONUS_OF_MOST_RECENT_FILE }
}

function recentBonusOfFile(recentFiles: RecentFiles, fileIndex: number): number {
  return recentFiles.highestBonus === 0 ? 0 : (recentFiles.bonusByFileIndex.get(fileIndex) ?? 0)
}

// A class-like stands for its file in the list, so it carries the bonus of a recent file.
function recentBonusOfSymbol(source: PaletteSource, recentFiles: RecentFiles, symbolIndex: number): number {
  if (recentFiles.highestBonus === 0) {
    return 0
  }
  const symbol = source.symbols[symbolIndex]

  return symbol && isClassLikeKind(symbol.kind) ? recentBonusOfFile(recentFiles, source.fileOfSymbol[symbolIndex] ?? -1) : 0
}

// The scores of one query against the names of a table, each computed the first time it is asked for. A query
// searched as written only matches the names holding it letter after letter.
type NameScores = {
  query: FuzzyQuery
  table: NameTable
  isSearchedAsWritten: boolean
  scores: Int32Array
  highestScores: Int32Array
}

function createNameScores(query: FuzzyQuery, table: NameTable, isSearchedAsWritten: boolean): NameScores {
  return {
    query,
    table,
    isSearchedAsWritten,
    scores: new Int32Array(table.names.length).fill(NOT_SCORED_YET),
    highestScores: new Int32Array(table.names.length).fill(NOT_SCORED_YET),
  }
}

function canNameMatch({ query, table, isSearchedAsWritten }: NameScores, name: number): boolean {
  if (((table.characterMasks[name] ?? 0) & query.characterMask) !== query.characterMask) {
    return false
  }

  return !isSearchedAsWritten || (table.lowerCaseNames[name] ?? '').includes(query.lowerCaseText)
}

function scoreOfName(nameScores: NameScores, name: number): number {
  const knownScore = nameScores.scores[name] ?? NO_MATCH
  if (knownScore !== NOT_SCORED_YET) {
    return knownScore
  }
  const { query, table } = nameScores
  const score = canNameMatch(nameScores, name)
    ? (fuzzyScore(query, table.names[name] ?? '', table.lowerCaseNames[name] ?? '', 0) ?? NO_MATCH)
    : NO_MATCH
  nameScores.scores[name] = score

  return score
}

// The ceiling of the query's score against a name it is no prefix of, without aligning them.
function highestScoreOfNameWithoutPrefix(query: FuzzyQuery, table: NameTable, name: number): number {
  const lowerCaseName = table.lowerCaseNames[name] ?? ''
  let wordStartMask = table.wordStartMasks[name] ?? 0
  if (wordStartMask === 0) {
    wordStartMask = wordStartCharacterMaskOf(table.names[name] ?? '', lowerCaseName)
    table.wordStartMasks[name] = wordStartMask
  }
  const startsWithFirstCharacter = lowerCaseName.charCodeAt(0) === query.lowerCaseText.charCodeAt(0)

  return (
    highestFuzzyScoreWithoutPrefix(query, wordStartMask, startsWithFirstCharacter) -
    unmatchedNamePenalty(query.lowerCaseText.length, (table.names[name] ?? '').length)
  )
}

// The most the query can score against a name, without aligning them: its exact score when it starts the name,
// which costs nothing to compute, the ceiling of every other alignment otherwise.
function highestScoreOfName(nameScores: NameScores, name: number): number {
  const knownScore = nameScores.highestScores[name] ?? NO_MATCH
  if (knownScore !== NOT_SCORED_YET) {
    return knownScore
  }
  const { query, table } = nameScores
  let highestScore = NO_MATCH
  if (canNameMatch(nameScores, name)) {
    const lowerCaseName = table.lowerCaseNames[name] ?? ''
    highestScore = lowerCaseName.startsWith(query.lowerCaseText)
      ? scoreOfName(nameScores, name)
      : highestScoreOfNameWithoutPrefix(query, table, name)
  }
  nameScores.highestScores[name] = highestScore

  return highestScore
}

type NameScoreReader = (nameScores: NameScores, name: number) => number

// Hands every name of a shortest-first table that the query matches, with its score, to offerRowsOfName, leaving out
// the names that cannot enter the selection any more: past a length no name can, the unmatched characters costing
// too much, and before that length a name the query is no prefix of often cannot either.
function offerMatchingNames(
  top: TopRows,
  query: FuzzyQuery,
  table: NameTable,
  highestRankingBonusByName: Int8Array,
  recentFiles: RecentFiles,
  offerRowsOfName: (name: number, nameScore: number) => void,
): void {
  const { names, lowerCaseNames, characterMasks } = table
  const queryLength = query.lowerCaseText.length
  const highestRankingBonusOfAnyName = HIGHEST_RANKING_BONUS_OF_A_KIND + recentFiles.highestBonus
  const highestScoreOfWholeName = highestFuzzyScore(query, true) + highestRankingBonusOfAnyName
  const highestScoreOfLongerName = highestFuzzyScore(query, table.isAnyNameHoldingDot) + highestRankingBonusOfAnyName
  // The ceiling of a name whose every character would start a word: no other name's is higher, and it needs no mask.
  const highestScoreWithoutPrefix = highestFuzzyScoreWithoutPrefix(query, EVERY_CHARACTER_MASK, true)
  for (let name = 0; name < names.length; name++) {
    if (((characterMasks[name] ?? 0) & query.characterMask) !== query.characterMask) {
      continue
    }
    const nameLength = (names[name] ?? '').length
    const lengthPenalty = unmatchedNamePenalty(queryLength, nameLength)
    const lowestScoreKept = scoreToEnter(top)
    if ((nameLength > queryLength ? highestScoreOfLongerName : highestScoreOfWholeName) - lengthPenalty < lowestScoreKept) {
      break
    }
    const lowerCaseName = lowerCaseNames[name] ?? ''
    const highestRankingBonus = (highestRankingBonusByName[name] ?? 0) + recentFiles.highestBonus
    if (
      !lowerCaseName.startsWith(query.lowerCaseText) &&
      (highestScoreWithoutPrefix - lengthPenalty + highestRankingBonus < lowestScoreKept ||
        highestScoreOfNameWithoutPrefix(query, table, name) + highestRankingBonus < lowestScoreKept)
    ) {
      continue
    }
    const nameScore = fuzzyScore(query, names[name] ?? '', lowerCaseName, 0)
    if (nameScore !== null && nameScore + highestRankingBonus >= lowestScoreKept) {
      offerRowsOfName(name, nameScore)
    }
  }
}

function offerFilesNamed(
  top: TopRows,
  query: FuzzyQuery,
  source: PaletteSource,
  recentFiles: RecentFiles,
  leavesOutFilesNamedAfterTheirClassLike: boolean,
): void {
  const { starts, rows } = source.filesByName
  offerMatchingNames(top, query, source.fileNames, source.highestFileRankingBonusByName, recentFiles, (name, nameScore) => {
    // The class-like matches whenever the query fits in the name before the extension: its row replaces the file's.
    const lowerCaseName = source.fileNames.lowerCaseNames[name] ?? ''
    const isClassLikeMatchedToo =
      leavesOutFilesNamedAfterTheirClassLike && isFuzzySubsequence(query, lowerCaseName.slice(0, lowerCaseName.lastIndexOf('.')))
    for (let slot = starts[name] ?? 0; slot < (starts[name + 1] ?? 0); slot++) {
      const fileIndex = rows[slot] ?? 0
      if (isClassLikeMatchedToo && source.isFileNamedAfterItsClassLike[fileIndex] === 1) {
        continue
      }
      offerRow(top, nameScore + (source.fileRankingBonuses[fileIndex] ?? 0) + recentBonusOfFile(recentFiles, fileIndex), fileIndex)
    }
  })
}

function offerSymbolsNamed(top: TopRows, query: FuzzyQuery, source: PaletteSource, recentFiles: RecentFiles): void {
  const { starts, rows } = source.symbolsByName
  offerMatchingNames(top, query, source.symbolNames, source.highestSymbolRankingBonusByName, recentFiles, (name, nameScore) => {
    for (let slot = starts[name] ?? 0; slot < (starts[name + 1] ?? 0); slot++) {
      const symbolIndex = rows[slot] ?? 0
      const rankingBonus = (source.symbolRankingBonuses[symbolIndex] ?? 0) + recentBonusOfSymbol(source, recentFiles, symbolIndex)
      offerRow(top, nameScore + rankingBonus, source.files.length + symbolIndex)
    }
  })
}

// "::save": the members of any container, searched by their name as a plain query searches every symbol.
function offerMembersNamed(top: TopRows, memberQuery: FuzzyQuery, source: PaletteSource, recentFiles: RecentFiles): void {
  const { starts, rows } = source.symbolsByName
  offerMatchingNames(top, memberQuery, source.symbolNames, source.highestSymbolRankingBonusByName, recentFiles, (name, nameScore) => {
    for (let slot = starts[name] ?? 0; slot < (starts[name + 1] ?? 0); slot++) {
      const symbolIndex = rows[slot] ?? 0
      if (source.containerNameOfSymbol[symbolIndex] !== -1) {
        offerRow(top, nameScore + (source.symbolRankingBonuses[symbolIndex] ?? 0), source.files.length + symbolIndex)
      }
    }
  })
}

function offerMembers(top: TopRows, containerQuery: FuzzyQuery, memberQuery: FuzzyQuery, source: PaletteSource): void {
  const { starts, rows } = source.membersByContainerName
  const containerScores = createNameScores(containerQuery, source.symbolNames, false)
  const memberScores = createNameScores(memberQuery, source.symbolNames, false)
  for (let containerName = 0; containerName < source.symbolNames.names.length; containerName++) {
    if (starts[containerName] === starts[containerName + 1]) {
      continue
    }
    const containerScore = scoreOfName(containerScores, containerName)
    if (containerScore === NO_MATCH) {
      continue
    }
    for (let slot = starts[containerName] ?? 0; slot < (starts[containerName + 1] ?? 0); slot++) {
      const symbolIndex = rows[slot] ?? 0
      const memberScore = scoreOfName(memberScores, source.nameOfSymbol[symbolIndex] ?? 0)
      if (memberScore !== NO_MATCH) {
        offerRow(top, containerScore + memberScore + (source.symbolRankingBonuses[symbolIndex] ?? 0), source.files.length + symbolIndex)
      }
    }
  }
}

function countOfNamesHoldingCharactersOf(query: FuzzyQuery, table: NameTable): number {
  let count = 0
  for (let name = 0; name < table.names.length; name++) {
    if (((table.characterMasks[name] ?? 0) & query.characterMask) === query.characterMask) {
      count += 1
    }
  }

  return count
}

// The words in the order that rejects a row soonest: the word the fewest names can hold first, the others being
// scored against the names of the rows it leaves.
function mostSelectiveFirst<Word>(words: readonly Word[], table: NameTable, queryOfWord: (word: Word) => FuzzyQuery | null): Word[] {
  const countByWord = new Map(
    words.map(word => {
      const query = queryOfWord(word)

      return [word, query ? countOfNamesHoldingCharactersOf(query, table) : 0]
    }),
  )

  return [...words].sort((first, second) => (countByWord.get(first) ?? 0) - (countByWord.get(second) ?? 0))
}

// The summed scores of the words against a symbol, each found in its name or in its container's, NO_MATCH when a
// word is found in neither or when none is found in the symbol's own name: a member whose container alone answers
// the query adds nothing to the container's row.
function summedScoreOfWordsForSymbol(
  scoresByWord: readonly NameScores[],
  name: number,
  containerName: number,
  scoreOfNameReader: NameScoreReader,
): number {
  let summedScore = 0
  let isAnyWordInName = false
  for (const scoresOfWord of scoresByWord) {
    const scoreInName = scoreOfNameReader(scoresOfWord, name)
    const scoreInContainer = containerName === -1 ? NO_MATCH : scoreOfNameReader(scoresOfWord, containerName)
    if (scoreInName === NO_MATCH && scoreInContainer === NO_MATCH) {
      return NO_MATCH
    }
    isAnyWordInName ||= scoreInName !== NO_MATCH
    summedScore += Math.max(scoreInName, scoreInContainer)
  }

  return isAnyWordInName ? summedScore : NO_MATCH
}

// The symbols are walked from the shortest name on, so that the best rows come early and the others are left out on
// the ceiling of their score, before any alignment.
function offerSymbolsMatchingEveryWord(
  top: TopRows,
  words: readonly FuzzyQuery[],
  source: PaletteSource,
  recentFiles: RecentFiles,
  isSearchedAsWritten: boolean,
): void {
  const table = source.symbolNames
  const { starts, rows } = source.symbolsByName
  const scoresByWord = mostSelectiveFirst(words, table, word => word).map(word => createNameScores(word, table, isSearchedAsWritten))
  for (let name = 0; name < table.names.length; name++) {
    for (let slot = starts[name] ?? 0; slot < (starts[name + 1] ?? 0); slot++) {
      const symbolIndex = rows[slot] ?? 0
      const containerName = source.containerNameOfSymbol[symbolIndex] ?? -1
      const highestScore = summedScoreOfWordsForSymbol(scoresByWord, name, containerName, highestScoreOfName)
      if (highestScore === NO_MATCH) {
        continue
      }
      const rankingBonus = (source.symbolRankingBonuses[symbolIndex] ?? 0) + recentBonusOfSymbol(source, recentFiles, symbolIndex)
      if (highestScore + rankingBonus < scoreToEnter(top)) {
        continue
      }
      const score = summedScoreOfWordsForSymbol(scoresByWord, name, containerName, scoreOfName)
      if (score !== NO_MATCH) {
        offerRow(top, score + rankingBonus, source.files.length + symbolIndex)
      }
    }
  }
}

// One word of a query about files, cut at its slashes: "src/ord/rep" asks for src, then ord, then rep, each found in
// one name along the path, in that order. The last part may name the file; after a closing slash it names a directory.
type PathPattern = { parts: FuzzyQuery[]; namesOnlyDirectories: boolean }

function pathPatternsOf(queryText: string): PathPattern[] {
  return queryText
    .split(/\s+/)
    .map(word => ({
      parts: word
        .split('/')
        .filter(part => part !== '')
        .map(prepareFuzzyQuery),
      namesOnlyDirectories: word.endsWith('/'),
    }))
    .filter(pattern => pattern.parts.length > 0)
}

function fileNamePartOf(pattern: PathPattern): FuzzyQuery | null {
  return pattern.namesOnlyDirectories ? null : (pattern.parts.at(-1) ?? null)
}

// How a pattern fares against each directory, and against the file names scored so far.
type PathPatternScores = {
  // By directory: every part found along the directory, and every part but the last.
  everyPartAlongDirectory: Int32Array
  leadingPartsAlongDirectory: Int32Array
  // The last part against the file names, null when the pattern names a directory.
  lastPartInFileName: NameScores | null
}

function scorePathPattern(pattern: PathPattern, source: PaletteSource, isSearchedAsWritten: boolean): PathPatternScores {
  const partCount = pattern.parts.length
  const scoresByPart = pattern.parts.map(part => createNameScores(part, source.directoryNames, isSearchedAsWritten))
  const { starts, rows } = source.namesAlongDirectory
  const directoryCount = source.directoryDepths.length
  const everyPartAlongDirectory = new Int32Array(directoryCount)
  const leadingPartsAlongDirectory = new Int32Array(directoryCount)
  // bestScores[n]: the best score of the first n parts found, in order, in the names walked so far.
  const bestScores = new Int32Array(partCount + 1)
  for (let directory = 0; directory < directoryCount; directory++) {
    bestScores.fill(NO_MATCH)
    bestScores[0] = 0
    for (let slot = starts[directory] ?? 0; slot < (starts[directory + 1] ?? 0); slot++) {
      const directoryName = rows[slot] ?? 0
      for (let partIndex = partCount - 1; partIndex >= 0; partIndex--) {
        const scoreOfEarlierParts = bestScores[partIndex] ?? NO_MATCH
        const scoresOfPart = scoresByPart[partIndex]
        if (scoreOfEarlierParts === NO_MATCH || !scoresOfPart) {
          continue
        }
        const scoreOfPart = scoreOfName(scoresOfPart, directoryName)
        if (scoreOfPart !== NO_MATCH && scoreOfEarlierParts + scoreOfPart > (bestScores[partIndex + 1] ?? 0)) {
          bestScores[partIndex + 1] = scoreOfEarlierParts + scoreOfPart
        }
      }
    }
    everyPartAlongDirectory[directory] = bestScores[partCount] ?? NO_MATCH
    leadingPartsAlongDirectory[directory] = bestScores[partCount - 1] ?? NO_MATCH
  }
  const fileNamePart = fileNamePartOf(pattern)

  return {
    everyPartAlongDirectory,
    leadingPartsAlongDirectory,
    lastPartInFileName: fileNamePart ? createNameScores(fileNamePart, source.fileNames, isSearchedAsWritten) : null,
  }
}

function scoreOfFileForPathPattern(
  scores: PathPatternScores,
  source: PaletteSource,
  fileIndex: number,
  scoreOfNameReader: NameScoreReader,
): number {
  const directory = source.directoryOfFile[fileIndex] ?? 0
  const scoreAlongDirectory = scores.everyPartAlongDirectory[directory] ?? NO_MATCH
  const scoreNamingDirectory = scoreAlongDirectory === NO_MATCH ? NO_MATCH : scoreAlongDirectory - RANKING_PENALTY_OF_FILE_NAME_LEFT_UNMATCHED
  const scoreOfLeadingParts = scores.leadingPartsAlongDirectory[directory] ?? NO_MATCH
  if (scoreOfLeadingParts === NO_MATCH || scores.lastPartInFileName === null) {
    return scoreNamingDirectory
  }
  const scoreInFileName = scoreOfNameReader(scores.lastPartInFileName, source.nameOfFile[fileIndex] ?? 0)

  return scoreInFileName === NO_MATCH ? scoreNamingDirectory : Math.max(scoreNamingDirectory, scoreOfLeadingParts + scoreInFileName)
}

function summedScoreOfPathPatternsForFile(
  scoresByPattern: readonly PathPatternScores[],
  source: PaletteSource,
  fileIndex: number,
  scoreOfNameReader: NameScoreReader,
): number {
  let summedScore = 0
  for (const scores of scoresByPattern) {
    const score = scoreOfFileForPathPattern(scores, source, fileIndex, scoreOfNameReader)
    if (score === NO_MATCH) {
      return NO_MATCH
    }
    summedScore += score
  }

  return summedScore
}

function isClassLikeOfFileMatchedByEveryPattern(patterns: readonly PathPattern[], source: PaletteSource, fileIndex: number): boolean {
  if (source.isFileNamedAfterItsClassLike[fileIndex] !== 1) {
    return false
  }
  const lowerCaseName = source.fileNames.lowerCaseNames[source.nameOfFile[fileIndex] ?? 0] ?? ''
  const lowerCaseClassLikeName = lowerCaseName.slice(0, lowerCaseName.lastIndexOf('.'))

  return patterns.every(pattern => pattern.parts.length === 1 && pattern.parts.every(part => isFuzzySubsequence(part, lowerCaseClassLikeName)))
}

// The files are walked from the shortest name on, as the symbols are.
function offerFilesMatchingEveryPathPattern(
  top: TopRows,
  patterns: readonly PathPattern[],
  source: PaletteSource,
  recentFiles: RecentFiles,
  isSearchedAsWritten: boolean,
  leavesOutFilesNamedAfterTheirClassLike: boolean,
): void {
  const scoresByPattern = mostSelectiveFirst(patterns, source.fileNames, fileNamePartOf).map(pattern =>
    scorePathPattern(pattern, source, isSearchedAsWritten),
  )
  for (const fileIndex of source.filesByName.rows) {
    const highestScore = summedScoreOfPathPatternsForFile(scoresByPattern, source, fileIndex, highestScoreOfName)
    if (highestScore === NO_MATCH) {
      continue
    }
    const depthPenalty = (source.directoryDepths[source.directoryOfFile[fileIndex] ?? 0] ?? 0) * RANKING_PENALTY_PER_DIRECTORY
    const rankingBonus = (source.fileRankingBonuses[fileIndex] ?? 0) + recentBonusOfFile(recentFiles, fileIndex) - depthPenalty
    if (highestScore + rankingBonus < scoreToEnter(top)) {
      continue
    }
    const score = summedScoreOfPathPatternsForFile(scoresByPattern, source, fileIndex, scoreOfName)
    if (score === NO_MATCH) {
      continue
    }
    if (leavesOutFilesNamedAfterTheirClassLike && isClassLikeOfFileMatchedByEveryPattern(patterns, source, fileIndex)) {
      continue
    }
    offerRow(top, score + rankingBonus, fileIndex)
  }
}

function labelOfSymbol(symbol: SymbolEntry): string {
  return symbol.container === null ? symbol.name : `${symbol.container}${CONTAINER_SEPARATOR}${symbol.name}`
}

function nameStartInLabel(symbol: SymbolEntry): number {
  return symbol.container === null ? 0 : symbol.container.length + CONTAINER_SEPARATOR.length
}

function fileItem(path: string, matchedIndexes: number[], line: number): PaletteItem {
  const nameStart = fileNameStartOf(path)

  return {
    kind: 'file',
    symbolKind: null,
    label: path.slice(nameStart),
    detail: path.slice(0, Math.max(0, nameStart - 1)),
    matchedIndexes,
    path,
    line,
  }
}

function symbolItem(symbol: SymbolEntry, matchedIndexes: number[]): PaletteItem {
  return {
    kind: 'symbol',
    symbolKind: symbol.kind,
    label: labelOfSymbol(symbol),
    detail: `${symbol.path}:${symbol.line}`,
    matchedIndexes,
    path: symbol.path,
    line: symbol.line,
  }
}

function lineItem(path: string, line: number): PaletteItem {
  const item = fileItem(path, [], line)

  return { ...item, kind: 'line', label: `${item.label}:${line}` }
}

function sortedDistinct(indexes: number[]): number[] {
  return [...new Set(indexes)].sort((first, second) => first - second)
}

function indexesMatchedInName(query: FuzzyQuery, name: string): number[] {
  return fuzzyMatchedIndexes(query, name, name.toLowerCase(), 0)
}

// How a ranked row lights its label: each way of searching matched it against other texts.
type MatchedIndexesReader = {
  ofFile: (path: string) => number[]
  ofSymbol: (symbol: SymbolEntry) => number[]
}

function matchedInNameReader(query: FuzzyQuery): MatchedIndexesReader {
  return {
    ofFile: path => indexesMatchedInName(query, path.slice(fileNameStartOf(path))),
    ofSymbol: symbol => indexesMatchedInName(query, symbol.name).map(index => index + nameStartInLabel(symbol)),
  }
}

function matchedMemberReader(containerQuery: FuzzyQuery, memberQuery: FuzzyQuery, wholeQuery: FuzzyQuery): MatchedIndexesReader {
  return {
    ofFile: matchedInNameReader(wholeQuery).ofFile,
    ofSymbol: symbol => [
      ...indexesMatchedInName(containerQuery, symbol.container ?? ''),
      ...indexesMatchedInName(memberQuery, symbol.name).map(index => index + nameStartInLabel(symbol)),
    ],
  }
}

function indexesOfWordInSymbolLabel(word: FuzzyQuery, symbol: SymbolEntry): number[] {
  const scoreInName = fuzzyScore(word, symbol.name, symbol.name.toLowerCase(), 0) ?? NO_MATCH
  const scoreInContainer =
    symbol.container === null ? NO_MATCH : (fuzzyScore(word, symbol.container, symbol.container.toLowerCase(), 0) ?? NO_MATCH)

  return scoreInContainer > scoreInName
    ? indexesMatchedInName(word, symbol.container ?? '')
    : indexesMatchedInName(word, symbol.name).map(index => index + nameStartInLabel(symbol))
}

function matchedByWordsReader(patterns: readonly PathPattern[]): MatchedIndexesReader {
  const partsNamingFiles = patterns.flatMap(pattern => fileNamePartOf(pattern) ?? [])
  const words = patterns.flatMap(pattern => pattern.parts)

  return {
    ofFile: path => {
      const name = path.slice(fileNameStartOf(path))

      return sortedDistinct(partsNamingFiles.flatMap(part => indexesMatchedInName(part, name)))
    },
    ofSymbol: symbol => sortedDistinct(words.flatMap(word => indexesOfWordInSymbolLabel(word, symbol))),
  }
}

function itemsOfTopRows(top: TopRows, matchedIndexes: MatchedIndexesReader, fileLine: number): PaletteItem[] {
  const { files, symbols } = top.source

  return rankedRows(top).flatMap(row => {
    const symbol = symbols[row - files.length]
    if (symbol) {
      return [symbolItem(symbol, matchedIndexes.ofSymbol(symbol))]
    }
    const path = files[row]

    return path === undefined ? [] : [fileItem(path, matchedIndexes.ofFile(path), fileLine)]
  })
}

function recentFileItems(context: PaletteContext, limit: number): PaletteItem[] {
  const recentPaths = [...new Set(context.recentPaths)].filter(path => path !== context.currentPath)

  return recentPaths.slice(0, limit).map(path => fileItem(path, [], FIRST_LINE))
}

// The files and, when asked, the symbols matching every word of a query. The words are first searched as written,
// which is what most are and rejects a name at once; only when that finds nothing are they matched loosely, a
// letter here and a letter there.
function rowsMatchingEveryWord(
  queryText: string,
  source: PaletteSource,
  recentFiles: RecentFiles,
  limit: number,
  fileLine: number,
  listsSymbols: boolean,
): PaletteItem[] {
  const patterns = pathPatternsOf(queryText)
  if (patterns.length === 0) {
    return []
  }
  const words = patterns.flatMap(pattern => pattern.parts)
  const topRowsOf = (isSearchedAsWritten: boolean): TopRows => {
    const top = createTopRows(limit, source)
    if (listsSymbols) {
      offerSymbolsMatchingEveryWord(top, words, source, recentFiles, isSearchedAsWritten)
    }
    offerFilesMatchingEveryPathPattern(top, patterns, source, recentFiles, isSearchedAsWritten, listsSymbols)

    return top
  }
  const topRowsAsWritten = topRowsOf(true)

  return itemsOfTopRows(topRowsAsWritten.count > 0 ? topRowsAsWritten : topRowsOf(false), matchedByWordsReader(patterns), fileLine)
}

// The files a query names, without the symbols: by the names along their path when it holds a slash or several words.
function filesMatching(queryText: string, source: PaletteSource, recentFiles: RecentFiles, limit: number, line: number): PaletteItem[] {
  if (/[\s/]/.test(queryText)) {
    return rowsMatchingEveryWord(queryText, source, recentFiles, limit, line, false)
  }
  const top = createTopRows(limit, source)
  const query = prepareFuzzyQuery(queryText)
  offerFilesNamed(top, query, source, recentFiles, false)

  return itemsOfTopRows(top, matchedInNameReader(query), line)
}

const LINE_SUFFIX = /^(.*):(\d+)$/
// "Order::save", "Order#save" or "Order.save": a member named like the second part, in a container matching the first.
const MEMBER_QUERY = /^([^:#.]*)(::|#|\.)(.*)$/

// The rows of the palette for a query, best first, at most limit of them:
// - nothing typed: the recent files, the current one left out;
// - "name:42": the files matching name, to open on line 42, and ":42" alone that line of the current file;
// - a slash: files only, each part between slashes found in one name along the path, in that order;
// - several words: files and symbols matching every word, in any order;
// - "Order::save", "Order#save", "Order.save": the members of the containers matching the first part;
// - anything else: files by their name and symbols by theirs, ranked together.
export function searchPalette(query: string, source: PaletteSource, context: PaletteContext, limit: number): PaletteItem[] {
  const queryText = query.trim()
  if (limit <= 0) {
    return []
  }
  if (queryText === '') {
    return recentFileItems(context, limit)
  }
  const recentFiles = recentFilesOf(source, context.recentPaths)
  const lineSuffix = queryText.match(LINE_SUFFIX)
  if (lineSuffix) {
    const fileQueryText = (lineSuffix[1] ?? '').trim()
    const line = Math.max(FIRST_LINE, Number(lineSuffix[2]))
    if (fileQueryText === '') {
      return context.currentPath === null ? [] : [lineItem(context.currentPath, line)]
    }

    return filesMatching(fileQueryText, source, recentFiles, limit, line)
  }
  if (queryText.includes('/')) {
    return filesMatching(queryText, source, recentFiles, limit, FIRST_LINE)
  }
  if (/\s/.test(queryText)) {
    return rowsMatchingEveryWord(queryText, source, recentFiles, limit, FIRST_LINE, true)
  }
  const top = createTopRows(limit, source)
  const wholeQuery = prepareFuzzyQuery(queryText)
  const memberQuery = queryText.match(MEMBER_QUERY)
  if (memberQuery) {
    const [, containerText = '', separator = '', memberText = ''] = memberQuery
    const containerQuery = prepareFuzzyQuery(containerText)
    const namedMemberQuery = prepareFuzzyQuery(memberText)
    // A dot also belongs to file names: "order.ts" lists the file beside the members of Order starting with ts.
    if (separator === '.') {
      offerFilesNamed(top, wholeQuery, source, recentFiles, false)
    }
    if (containerText !== '') {
      offerMembers(top, containerQuery, namedMemberQuery, source)
    } else if (separator !== '.') {
      offerMembersNamed(top, namedMemberQuery, source, recentFiles)
    }

    return itemsOfTopRows(top, matchedMemberReader(containerQuery, namedMemberQuery, wholeQuery), FIRST_LINE)
  }
  // The symbols first: five times as many as the files, they fill the selection with rows the files are then
  // measured against, most of them left out without being aligned.
  offerSymbolsNamed(top, wholeQuery, source, recentFiles)
  offerFilesNamed(top, wholeQuery, source, recentFiles, true)

  return itemsOfTopRows(top, matchedInNameReader(wholeQuery), FIRST_LINE)
}
