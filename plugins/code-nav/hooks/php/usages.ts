import type { CodePosition, Usage, UsageCertainty, UsagesAnswer } from '../../types'
import type { SearchMatch, Workspace } from '../workspace'
import { classReferenceAt, readPhpClick } from './click'
import { receiverTypeOfMemberAccess } from './inference'
import { lineTextAt, positionOfOffset, shortNameOf } from './outline'
import type { PhpFileOutline } from './outline'
import { ancestorNamesOf, createPhpProject } from './project'
import type { PhpMemberKind, PhpProject } from './project'
import { memberLabelOf, resolvePhpClick, variableOccurrencesIn } from './resolution'
import type { PhpSubject } from './resolution'
import { offsetOfLineAndColumn } from '../text-position'
import { tokenIndexAtOffset } from './tokens'
import { classMembersOf, isPhpOwnValue } from './type-expression'

type FoundUsages = { title: string; usages: Usage[]; isTruncated: boolean; note: string | null }

const MAXIMUM_ANALYSED_MATCHES = 1000
const PHP_FILES = ['*.php']
const OWN_CLASS_NAMES = new Set(['self', 'static', 'parent'])
const NOT_A_PLAIN_NAME_AFTER = new Set(['->', '?->', '::', 'function', 'new', 'const'])
const CERTAINTY_ORDER: Record<UsageCertainty, number> = { confirmed: 0, unverified: 1 }

function usageAtOffset(outline: PhpFileOutline, offset: number, certainty: UsageCertainty): Usage {
  const { line, column } = positionOfOffset(outline, offset)

  return { path: outline.path, line, column, preview: lineTextAt(outline, line).trim(), certainty }
}

function matchesByPath(matches: readonly SearchMatch[]): Map<string, SearchMatch[]> {
  const grouped = new Map<string, SearchMatch[]>()
  for (const match of matches) {
    const matchesOfPath = grouped.get(match.path)
    if (matchesOfPath === undefined) {
      grouped.set(match.path, [match])
    } else {
      matchesOfPath.push(match)
    }
  }

  return grouped
}

async function searchCapped(project: PhpProject, pattern: string): Promise<{ matches: SearchMatch[]; isTruncated: boolean }> {
  const matches = await project.workspace.search(pattern, { globs: PHP_FILES, maxMatches: MAXIMUM_ANALYSED_MATCHES + 1 })

  return { matches: matches.slice(0, MAXIMUM_ANALYSED_MATCHES), isTruncated: matches.length > MAXIMUM_ANALYSED_MATCHES }
}

// Every place a file names the class: its code where a class stands and the types of its docblocks. Its use
// statements are left out: a file importing the class would otherwise be listed twice, once for nothing to read.
function classReferencesIn(outline: PhpFileOutline, fullyQualifiedName: string): number[] {
  const { tokens, comments } = outline.source
  const offsets: number[] = []
  for (const tokenIndex of outline.classReferenceTokenIndexes) {
    if (outline.importsByTokenIndex.has(tokenIndex)) {
      continue
    }
    const token = tokens[tokenIndex]
    const isAliasOfImport = tokens[tokenIndex - 1]?.text === 'as'
    if (token !== undefined && !isAliasOfImport && !OWN_CLASS_NAMES.has(token.text) && classReferenceAt(outline, tokenIndex) === fullyQualifiedName) {
      offsets.push(token.start)
    }
  }
  const writtenNames = [shortNameOf(fullyQualifiedName)]
  for (const [alias, importedName] of outline.classImports) {
    if (importedName === fullyQualifiedName && !writtenNames.includes(alias)) {
      writtenNames.push(alias)
    }
  }
  const writtenNamePattern = new RegExp(`\\b(?:${writtenNames.join('|')})\\b`, 'g')
  for (const comment of comments) {
    if (!comment.text.startsWith('/*')) {
      continue
    }
    for (const match of comment.text.matchAll(writtenNamePattern)) {
      const matchStart = comment.start + match.index
      const click = readPhpClick(outline, matchStart)
      const isTheClass = click.kind === 'classReference' && click.fullyQualifiedName === fullyQualifiedName
      if (isTheClass && click.range.end === matchStart + match[0].length) {
        offsets.push(click.range.start)
      }
    }
  }

  return [...new Set(offsets)].sort((first, second) => first - second)
}

async function usagesOfClass(project: PhpProject, fullyQualifiedName: string): Promise<FoundUsages> {
  const shortName = shortNameOf(fullyQualifiedName)
  const { matches, isTruncated } = await searchCapped(project, `\\b${shortName}\\b`)
  const usages: Usage[] = []
  for (const path of matchesByPath(matches).keys()) {
    const outline = await project.outlineOfFile(path)
    if (outline !== null) {
      usages.push(...classReferencesIn(outline, fullyQualifiedName).map(offset => usageAtOffset(outline, offset, 'confirmed')))
    }
  }

  return { title: shortName, usages, isTruncated, note: null }
}

function memberAccessPattern(memberKind: PhpMemberKind, name: string): string {
  const patternByKind: Record<PhpMemberKind, string> = {
    method: `(->|::)${name}\\b`,
    property: `(->|::\\$)${name}\\b`,
    constant: `::${name}\\b`,
  }

  return patternByKind[memberKind]
}

// The token of the member's name for a text match on "->name" or "::name"; -1 when the match is inside a comment or
// a string, or is another kind of member (a property read where a method call is searched).
function memberTokenIndexOfMatch(outline: PhpFileOutline, match: SearchMatch, memberKind: PhpMemberKind, name: string): number {
  const { tokens, lineStartOffsets } = outline.source
  const matchOffset = offsetOfLineAndColumn(lineStartOffsets, match.line, match.column)
  const operatorTokenIndex = matchOffset === null ? -1 : tokenIndexAtOffset(tokens, matchOffset)
  const operatorText = tokens[operatorTokenIndex]?.text ?? ''
  const memberToken = tokens[operatorTokenIndex + 1]
  if (memberToken === undefined || (operatorText !== '->' && operatorText !== '?->' && operatorText !== '::')) {
    return -1
  }
  const isCall = tokens[operatorTokenIndex + 2]?.text === '('
  const isWantedByKind: Record<PhpMemberKind, boolean> = {
    method: memberToken.text === name && isCall,
    property: (memberToken.text === name && operatorText !== '::' && !isCall) || (memberToken.text === `$${name}` && operatorText === '::'),
    constant: memberToken.text === name && operatorText === '::' && !isCall,
  }

  return isWantedByKind[memberKind] ? operatorTokenIndex + 1 : -1
}

async function usagesOfMember(project: PhpProject, subject: Extract<PhpSubject, { kind: 'member' }>, fromPath: string): Promise<FoundUsages> {
  const { memberKind, name, declaringClassNames } = subject
  const { matches, isTruncated } = await searchCapped(project, memberAccessPattern(memberKind, name))
  const firstDeclaringClassName = declaringClassNames[0]
  const title = firstDeclaringClassName === undefined ? name : memberLabelOf(shortNameOf(firstDeclaringClassName), memberKind, name)
  const familyClassNames = new Set(declaringClassNames)
  for (const declaringClassName of declaringClassNames) {
    for (const ancestorName of await ancestorNamesOf(project, declaringClassName, fromPath)) {
      familyClassNames.add(ancestorName)
    }
  }
  const ancestorNamesPromiseByClassName = new Map<string, Promise<Set<string>>>()
  const isRelatedClass = async (className: string, fromPath: string): Promise<boolean> => {
    if (familyClassNames.has(className)) {
      return true
    }
    let ancestorNamesPromise = ancestorNamesPromiseByClassName.get(className)
    if (ancestorNamesPromise === undefined) {
      ancestorNamesPromise = ancestorNamesOf(project, className, fromPath)
      ancestorNamesPromiseByClassName.set(className, ancestorNamesPromise)
    }
    const ancestorNames = await ancestorNamesPromise

    return declaringClassNames.some(declaringClassName => ancestorNames.has(declaringClassName))
  }

  const usages: Usage[] = []
  for (const [path, matchesOfPath] of matchesByPath(matches)) {
    const outline = await project.outlineOfFile(path)
    if (outline === null) {
      continue
    }
    for (const match of matchesOfPath) {
      const memberTokenIndex = memberTokenIndexOfMatch(outline, match, memberKind, name)
      const memberOffset = outline.source.tokens[memberTokenIndex]?.start
      if (memberOffset === undefined) {
        continue
      }
      if (declaringClassNames.length === 0) {
        usages.push(usageAtOffset(outline, memberOffset, 'unverified'))
        continue
      }
      const receiverType = await receiverTypeOfMemberAccess({ project, outline }, memberTokenIndex).catch(() => [])
      const receiverClasses = classMembersOf(receiverType)
      if (receiverClasses.length === 0) {
        if (!isPhpOwnValue(receiverType)) {
          usages.push(usageAtOffset(outline, memberOffset, 'unverified'))
        }
        continue
      }
      for (const receiverClass of receiverClasses) {
        if (await isRelatedClass(receiverClass.name, path)) {
          usages.push(usageAtOffset(outline, memberOffset, 'confirmed'))
          break
        }
      }
    }
  }
  const note = declaringClassNames.length === 0 ? `The class holding ${name} could not be read: every access to that name is listed` : null

  return { title, usages: usages.sort((first, second) => CERTAINTY_ORDER[first.certainty] - CERTAINTY_ORDER[second.certainty]), isTruncated, note }
}

async function usagesOfPlainName(project: PhpProject, name: string, pattern: string, isCallWanted: boolean): Promise<FoundUsages> {
  const { matches, isTruncated } = await searchCapped(project, pattern)
  const usages: Usage[] = []
  for (const [path, matchesOfPath] of matchesByPath(matches)) {
    const outline = await project.outlineOfFile(path)
    if (outline === null) {
      continue
    }
    const { tokens, lineStartOffsets } = outline.source
    for (const match of matchesOfPath) {
      const matchOffset = offsetOfLineAndColumn(lineStartOffsets, match.line, match.column)
      const tokenIndex = matchOffset === null ? -1 : tokenIndexAtOffset(tokens, matchOffset)
      const token = tokens[tokenIndex]
      const previousText = tokens[tokenIndex - 1]?.text ?? ''
      const isMemberOrDeclaration = NOT_A_PLAIN_NAME_AFTER.has(previousText) || outline.declarationsByTokenIndex.has(tokenIndex)
      const isCall = tokens[tokenIndex + 1]?.text === '('
      if (token !== undefined && token.kind === 'name' && shortNameOf(token.text) === name && !isMemberOrDeclaration && isCall === isCallWanted) {
        usages.push(usageAtOffset(outline, token.start, 'confirmed'))
      }
    }
  }

  return { title: name, usages, isTruncated, note: null }
}

function usagesOfVariable(outline: PhpFileOutline, subject: Extract<PhpSubject, { kind: 'variable' }>): FoundUsages {
  const { tokens } = outline.source
  const usages = variableOccurrencesIn(outline, subject.name, subject.functionScope)
    .filter(tokenIndex => tokenIndex !== subject.declarationTokenIndex)
    .map(tokenIndex => usageAtOffset(outline, tokens[tokenIndex]?.start ?? 0, 'confirmed'))

  return { title: subject.name, usages, isTruncated: false, note: null }
}

// Where the symbol under a click is used, from its declaration or from any reference to it.
export async function findPhpUsages(workspace: Workspace, position: CodePosition): Promise<UsagesAnswer> {
  const project = createPhpProject(workspace)
  const { symbol, subject, outline, note } = await resolvePhpClick(project, position)
  if (subject === null || outline === null) {
    return { symbol, title: symbol?.name ?? '', usages: [], isTruncated: false, note }
  }
  let foundUsages: FoundUsages
  switch (subject.kind) {
    case 'class':
      foundUsages = await usagesOfClass(project, subject.fullyQualifiedName)
      break
    case 'member':
      foundUsages = await usagesOfMember(project, subject, outline.path)
      break
    case 'function':
      foundUsages = await usagesOfPlainName(project, subject.name, `\\b${subject.name}\\s*\\(`, true)
      break
    case 'constant':
      foundUsages = await usagesOfPlainName(project, subject.name, `\\b${subject.name}\\b`, false)
      break
    case 'variable':
      foundUsages = usagesOfVariable(outline, subject)
      break
    default: {
      const unhandledSubject: never = subject

      return unhandledSubject
    }
  }

  return { symbol, ...foundUsages }
}
