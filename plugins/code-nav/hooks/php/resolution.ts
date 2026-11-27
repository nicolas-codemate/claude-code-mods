import { directoryOf } from '../script/paths'
import type { ClickedSymbol, CodePosition, NavigationTarget, SymbolEntry, SymbolKind, TargetCertainty } from '../../types'
import { readPhpClick } from './click'
import type { PhpClick, PhpNameRange } from './click'
import { functionDeclarationNamed, receiverTypeOfMemberAccess } from './inference'
import { enclosingFunctionScopeAt, lineTextAt, positionOfOffset, shortNameOf } from './outline'
import type { PhpClassDeclaration, PhpClassKind, PhpDeclarationReference, PhpFileOutline, PhpFunctionScope } from './outline'
import { firstMemberInLineage } from './project'
import type { PhpFoundMember, PhpMemberKind, PhpProject } from './project'
import { offsetOfLineAndColumn } from '../text-position'
import { classMembersOf, classType, isPhpOwnValue } from './type-expression'
import type { PhpType, PhpTypeMember } from './type-expression'

// What a click is about, whatever it stands on (the declaration or a reference): what usages and implementations
// are then searched for.
export type PhpSubject =
  | { kind: 'class'; fullyQualifiedName: string }
  // declaringClassNames is empty when the receiver's type could not be read: the member is then known by name only.
  | { kind: 'member'; memberKind: PhpMemberKind; name: string; declaringClassNames: string[] }
  | { kind: 'function'; name: string }
  | { kind: 'variable'; name: string; functionScope: PhpFunctionScope | null; declarationTokenIndex: number | null }
  | { kind: 'constant'; name: string }

export type PhpResolution = {
  outline: PhpFileOutline | null
  symbol: ClickedSymbol | null
  subject: PhpSubject | null
  targets: NavigationTarget[]
  isOnDeclaration: boolean
  note: string | null
}

const EMPTY_RESOLUTION: PhpResolution = { outline: null, symbol: null, subject: null, targets: [], isOnDeclaration: false, note: null }
const MAXIMUM_RECEIVER_CLASSES = 6
const MAXIMUM_CANDIDATES = 40
const MAXIMUM_DEPENDENCY_CANDIDATES = 25
const MAXIMUM_DEPENDENCY_MATCHES = 80
const ENUM_BUILT_IN_MEMBERS = new Set(['value', 'name', 'cases', 'from', 'tryFrom'])
const SYMBOL_KIND_OF_MEMBER: Record<PhpMemberKind, SymbolKind> = { method: 'method', property: 'property', constant: 'constant' }
const CLASS_KIND_WORDS: Record<PhpClassKind, string> = { class: 'class', interface: 'interface', trait: 'trait', enum: 'enum' }
// Loose on purpose: the functions seen every day, answered without searching the dependencies for a declaration.
const COMMON_BUILT_IN_FUNCTIONS = new Set([
  'count', 'sprintf', 'printf', 'implode', 'explode', 'in_array', 'array_map', 'array_filter', 'array_keys', 'array_values', 'array_merge',
  'array_key_exists', 'array_search', 'array_slice', 'array_splice', 'array_unique', 'array_reduce', 'array_column', 'array_combine',
  'array_diff', 'array_flip', 'array_intersect', 'array_pop', 'array_push', 'array_shift', 'array_unshift', 'array_reverse', 'array_sum',
  'array_fill', 'array_fill_keys', 'array_key_first', 'array_key_last', 'array_is_list', 'array_walk', 'array_chunk', 'usort', 'uasort',
  'uksort', 'sort', 'rsort', 'ksort', 'krsort', 'asort', 'arsort', 'range', 'compact', 'extract', 'current', 'reset', 'end', 'next', 'key',
  'is_array', 'is_string', 'is_int', 'is_float', 'is_bool', 'is_null', 'is_numeric', 'is_object', 'is_callable', 'is_iterable', 'is_a',
  'is_subclass_of', 'intval', 'floatval', 'strval', 'boolval', 'settype', 'gettype', 'get_class', 'get_debug_type', 'get_object_vars',
  'method_exists', 'property_exists', 'function_exists', 'class_exists', 'interface_exists', 'enum_exists', 'defined', 'define', 'constant',
  'strlen', 'strtolower', 'strtoupper', 'ucfirst', 'lcfirst', 'ucwords', 'trim', 'ltrim', 'rtrim', 'str_replace', 'str_contains',
  'str_starts_with', 'str_ends_with', 'str_pad', 'str_repeat', 'str_split', 'strpos', 'stripos', 'strrpos', 'substr', 'substr_count',
  'strcmp', 'strcasecmp', 'strtr', 'strrev', 'nl2br', 'number_format', 'htmlspecialchars', 'html_entity_decode', 'addslashes', 'md5', 'sha1',
  'hash', 'crc32', 'base64_encode', 'base64_decode', 'bin2hex', 'hex2bin', 'random_int', 'random_bytes', 'uniqid', 'mb_strlen',
  'mb_substr', 'mb_strtolower', 'mb_strtoupper', 'mb_strpos', 'preg_match', 'preg_match_all', 'preg_replace', 'preg_replace_callback',
  'preg_split', 'preg_quote', 'json_encode', 'json_decode', 'serialize', 'unserialize', 'var_dump', 'var_export', 'print_r', 'min', 'max',
  'abs', 'ceil', 'floor', 'round', 'intdiv', 'fmod', 'pow', 'sqrt', 'time', 'microtime', 'date', 'strtotime', 'mktime', 'checkdate',
  'sleep', 'usleep', 'file_get_contents', 'file_put_contents', 'file_exists', 'is_file', 'is_dir', 'mkdir', 'unlink', 'fopen', 'fclose',
  'fwrite', 'fgets', 'fgetcsv', 'fputcsv', 'basename', 'dirname', 'pathinfo', 'realpath', 'sys_get_temp_dir', 'tempnam', 'func_get_args',
  'call_user_func', 'call_user_func_array', 'iterator_to_array', 'spl_object_id', 'spl_object_hash', 'spl_autoload_register',
  'trigger_error', 'error_log', 'assert', 'ctype_digit', 'filter_var', 'http_build_query', 'parse_url', 'urlencode', 'rawurlencode',
  'urldecode', 'getenv', 'ini_set', 'set_error_handler', 'memory_get_usage', 'gc_collect_cycles', 'password_hash', 'password_verify',
])

function isBuiltInFunctionName(name: string): boolean {
  return COMMON_BUILT_IN_FUNCTIONS.has(name.toLowerCase())
}

function symbolOf(outline: PhpFileOutline, range: PhpNameRange, name: string, description: string): ClickedSymbol {
  const { line, column } = positionOfOffset(outline, range.start)

  return { name, line, startColumn: column, endColumn: column + (range.end - range.start), description }
}

export function targetAtOffset(
  project: PhpProject,
  outline: PhpFileOutline,
  offset: number,
  label: string,
  certainty: TargetCertainty,
): NavigationTarget {
  const { line, column } = positionOfOffset(outline, offset)
  const preview = lineTextAt(outline, line).trim()

  return { path: outline.path, line, column, label, preview, certainty, isDependency: project.isDependencyPath(outline.path) }
}

function targetAtToken(
  project: PhpProject,
  outline: PhpFileOutline,
  tokenIndex: number,
  label: string,
  certainty: TargetCertainty,
): NavigationTarget {
  return targetAtOffset(project, outline, outline.source.tokens[tokenIndex]?.start ?? 0, label, certainty)
}

export function classLabelOf(classDeclaration: PhpClassDeclaration): string {
  return classDeclaration.name === '' ? 'class@anonymous' : classDeclaration.name
}

// A property is written with its dollar sign, as PHP names it after "::".
const MEMBER_NAME_PREFIXES: Record<PhpMemberKind, string> = { method: '', property: '$', constant: '' }

export function memberLabelOf(className: string, memberKind: PhpMemberKind, memberName: string): string {
  return `${className}::${MEMBER_NAME_PREFIXES[memberKind]}${memberName}`
}

export function targetOfClass(project: PhpProject, outline: PhpFileOutline, classDeclaration: PhpClassDeclaration): NavigationTarget {
  return targetAtToken(project, outline, classDeclaration.nameTokenIndex, classLabelOf(classDeclaration), 'exact')
}

export function targetOfFoundMember(project: PhpProject, foundMember: PhpFoundMember, certainty: TargetCertainty): NavigationTarget {
  const { outline, classDeclaration } = foundMember.boundClass.located
  const className = classLabelOf(classDeclaration)
  switch (foundMember.kind) {
    case 'method': {
      const { method } = foundMember
      const label = memberLabelOf(className, 'method', method.name ?? '')

      return targetAtToken(project, outline, method.nameTokenIndex ?? method.keywordTokenIndex, label, certainty)
    }
    case 'property': {
      const { property } = foundMember

      return targetAtToken(project, outline, property.tokenIndex, memberLabelOf(className, 'property', property.name), certainty)
    }
    case 'constant': {
      const { constant } = foundMember

      return targetAtToken(project, outline, constant.tokenIndex, memberLabelOf(className, 'constant', constant.name), certainty)
    }
    case 'docblockMethod':
    case 'docblockProperty': {
      const { docblockMember } = foundMember
      const tagOffset = (classDeclaration.docblock?.start ?? 0) + docblockMember.offsetInDocblock
      const tagLine = positionOfOffset(outline, tagOffset).line
      const nameColumn = Math.max(0, lineTextAt(outline, tagLine).lastIndexOf(docblockMember.name))
      const memberKind = foundMember.kind === 'docblockMethod' ? 'method' : 'property'
      const lineStartOffset = outline.source.lineStartOffsets[tagLine - 1] ?? 0

      return targetAtOffset(project, outline, lineStartOffset + nameColumn, memberLabelOf(className, memberKind, docblockMember.name), certainty)
    }
    default: {
      const unhandledMember: never = foundMember

      return unhandledMember
    }
  }
}

function lineOfText(text: string, line: number): string {
  let lineStartOffset = 0
  for (let lineNumber = 1; lineNumber < line; lineNumber += 1) {
    const lineBreakOffset = text.indexOf('\n', lineStartOffset)
    if (lineBreakOffset === -1) {
      return ''
    }
    lineStartOffset = lineBreakOffset + 1
  }
  const lineBreakOffset = text.indexOf('\n', lineStartOffset)

  return text.slice(lineStartOffset, lineBreakOffset === -1 ? text.length : lineBreakOffset).replace(/\r$/, '')
}

async function targetOfSymbolEntry(project: PhpProject, symbol: SymbolEntry, label: string, certainty: TargetCertainty): Promise<NavigationTarget> {
  const text = await project.textOfFile(symbol.path)
  const lineText = text === null ? '' : lineOfText(text, symbol.line)
  const column = Math.max(0, lineText.indexOf(symbol.name))
  const isDependency = project.isDependencyPath(symbol.path)

  return { path: symbol.path, line: symbol.line, column, label, preview: lineText.trim(), certainty, isDependency }
}

// The declarations of a member name the project holds, the most plausible first: in a class the file imports or
// declares, then in a class of the same namespace, then the rest.
function rankedMemberCandidates(project: PhpProject, outline: PhpFileOutline, memberKind: PhpMemberKind, name: string): SymbolEntry[] {
  const importedShortNames = new Set([...outline.classImports.values()].map(shortNameOf))
  const fileDirectory = directoryOf(outline.path)
  const rankOf = (symbol: SymbolEntry): number => {
    if (symbol.path === outline.path || (symbol.container !== null && importedShortNames.has(symbol.container))) {
      return 0
    }

    return directoryOf(symbol.path) === fileDirectory ? 1 : 2
  }

  return project.workspace
    .symbolsNamed(name)
    .filter(symbol => symbol.kind === SYMBOL_KIND_OF_MEMBER[memberKind] && symbol.container !== null)
    .map((symbol, symbolIndex) => ({ symbol, rank: rankOf(symbol), symbolIndex }))
    .sort((first, second) => first.rank - second.rank || first.symbolIndex - second.symbolIndex)
    .map(ranked => ranked.symbol)
}

// Declarations of a function or method name inside the dependencies, searched as text: the last resort.
async function dependencyDeclarationsNamed(project: PhpProject, fromPath: string, name: string, isMethod: boolean): Promise<NavigationTarget[]> {
  const composerRoot = project.composerRootOf(fromPath)
  const vendorDirectory = composerRoot === null ? null : composerRoot === '' ? 'vendor' : `${composerRoot}/vendor`
  const matches = await project.workspace
    .search(`function\\s+&?${name}\\s*\\(`, {
      globs: ['*.php'],
      includeIgnored: true,
      maxMatches: MAXIMUM_DEPENDENCY_MATCHES,
      ...(vendorDirectory === null ? {} : { directory: vendorDirectory }),
    })
    .catch(() => [])
  const targets: NavigationTarget[] = []
  for (const match of matches) {
    const hasVisibility = /\b(public|protected|private|static|abstract|final)\b/.test(match.text)
    const isPlausible = isMethod ? hasVisibility || /^\s/.test(match.text) : !hasVisibility
    if (!project.isDependencyPath(match.path) || !isPlausible) {
      continue
    }
    const fileName = match.path.slice(match.path.lastIndexOf('/') + 1).replace(/\.php$/, '')
    targets.push({
      path: match.path,
      line: match.line,
      column: Math.max(match.column, match.text.indexOf(name, match.column)),
      label: isMethod ? memberLabelOf(fileName, 'method', name) : name,
      preview: match.text.trim(),
      certainty: 'candidate',
      isDependency: true,
    })
    if (targets.length >= MAXIMUM_DEPENDENCY_CANDIDATES) {
      break
    }
  }

  return targets
}

// Declarations of a property name in the project, searched as text for an index that lists no property: a
// visibility or readonly keyword, then the variable, a promoted constructor parameter included.
async function propertyDeclarationsNamed(project: PhpProject, name: string): Promise<NavigationTarget[]> {
  const matches = await project.workspace
    .search(`(public|protected|private|readonly|var|static)\\s[^;=()]*\\$${name}\\b`, { globs: ['*.php'], maxMatches: MAXIMUM_CANDIDATES })
    .catch(() => [])

  return matches.map(match => ({
    path: match.path,
    line: match.line,
    column: Math.max(match.column, match.text.indexOf(`$${name}`, match.column)),
    label: memberLabelOf(match.path.slice(match.path.lastIndexOf('/') + 1).replace(/\.php$/, ''), 'property', name),
    preview: match.text.trim(),
    certainty: 'candidate',
    isDependency: project.isDependencyPath(match.path),
  }))
}

function uniqueTargets(targets: NavigationTarget[]): NavigationTarget[] {
  const seenPlaces = new Set<string>()

  return targets.filter(target => {
    const place = `${target.path}:${target.line}:${target.column}`
    if (seenPlaces.has(place)) {
      return false
    }
    seenPlaces.add(place)

    return true
  })
}

// The function whose variables a variable belongs to: an arrow function reads its parent's, a closure those it
// names in its use clause.
export function scopeDeclaringVariable(outline: PhpFileOutline, variableName: string, tokenIndex: number): PhpFunctionScope | null {
  let functionScope = enclosingFunctionScopeAt(outline, tokenIndex)
  while (functionScope !== null) {
    const isOwnParameter = functionScope.parameters.some(parameter => parameter.name === variableName)
    const seesParentVariables = functionScope.kind === 'arrowFunction' || functionScope.capturedVariableNames.includes(variableName)
    if (isOwnParameter || !seesParentVariables) {
      return functionScope
    }
    functionScope = functionScope.parentScope
  }

  return null
}

// Every token of a variable within the function it belongs to, the arrow functions and capturing closures inside
// included, the other functions inside left out. With no function, the code outside any.
export function variableOccurrencesIn(outline: PhpFileOutline, variableName: string, functionScope: PhpFunctionScope | null): number[] {
  const { tokens } = outline.source
  const firstTokenIndex = functionScope === null ? 0 : functionScope.keywordTokenIndex
  const lastTokenIndex = functionScope === null ? tokens.length - 1 : functionScope.endTokenIndex
  const skippedEndByStart = new Map<number, number>()
  for (const innerScope of outline.functionScopes) {
    const isInside = innerScope.keywordTokenIndex > firstTokenIndex && innerScope.endTokenIndex <= lastTokenIndex
    const sharesTheVariable = innerScope.kind === 'arrowFunction' || innerScope.capturedVariableNames.includes(variableName)
    if (innerScope !== functionScope && (isInside || functionScope === null) && !sharesTheVariable) {
      skippedEndByStart.set(innerScope.keywordTokenIndex, innerScope.endTokenIndex)
    }
  }
  const occurrences: number[] = []
  for (let tokenIndex = firstTokenIndex; tokenIndex <= lastTokenIndex; tokenIndex += 1) {
    const skippedEnd = skippedEndByStart.get(tokenIndex)
    if (skippedEnd !== undefined) {
      tokenIndex = skippedEnd
      continue
    }
    const token = tokens[tokenIndex]
    if (token?.kind === 'variable' && token.text === variableName && tokens[tokenIndex - 1]?.text !== '::') {
      occurrences.push(tokenIndex)
    }
  }

  return occurrences
}

function resolveVariable(project: PhpProject, outline: PhpFileOutline, click: Extract<PhpClick, { kind: 'variable' }>): PhpResolution {
  const functionScope = scopeDeclaringVariable(outline, click.name, click.tokenIndex)
  const parameter = functionScope?.parameters.find(candidate => candidate.name === click.name)
  const declarationTokenIndex = parameter?.tokenIndex ?? variableOccurrencesIn(outline, click.name, functionScope)[0] ?? null
  const isOnDeclaration = declarationTokenIndex === click.tokenIndex
  const description = `${parameter === undefined ? 'variable' : 'parameter'} ${click.name}`

  return {
    outline,
    symbol: symbolOf(outline, click.range, click.name, description),
    subject: { kind: 'variable', name: click.name, functionScope, declarationTokenIndex },
    targets: declarationTokenIndex === null || isOnDeclaration ? [] : [targetAtToken(project, outline, declarationTokenIndex, click.name, 'exact')],
    isOnDeclaration,
    note: null,
  }
}

function resolveDeclaration(outline: PhpFileOutline, range: PhpNameRange, declaration: PhpDeclarationReference): PhpResolution {
  const onDeclaration = (name: string, description: string, subject: PhpSubject): PhpResolution => ({
    outline,
    symbol: symbolOf(outline, range, name, description),
    subject,
    targets: [],
    isOnDeclaration: true,
    note: null,
  })
  switch (declaration.kind) {
    case 'class': {
      const { classDeclaration } = declaration

      return onDeclaration(classDeclaration.name, `${CLASS_KIND_WORDS[classDeclaration.kind]} ${classDeclaration.name}`, {
        kind: 'class',
        fullyQualifiedName: classDeclaration.fullyQualifiedName,
      })
    }
    case 'method': {
      const name = declaration.method.name ?? ''

      return onDeclaration(name, `method ${name} of ${classLabelOf(declaration.classDeclaration)}`, {
        kind: 'member',
        memberKind: 'method',
        name,
        declaringClassNames: [declaration.classDeclaration.fullyQualifiedName],
      })
    }
    case 'property': {
      const { name } = declaration.property

      return onDeclaration(name, `property ${name} of ${classLabelOf(declaration.classDeclaration)}`, {
        kind: 'member',
        memberKind: 'property',
        name,
        declaringClassNames: [declaration.classDeclaration.fullyQualifiedName],
      })
    }
    case 'constant': {
      const { name } = declaration.constant
      if (declaration.classDeclaration === null) {
        return onDeclaration(name, `constant ${name}`, { kind: 'constant', name })
      }

      return onDeclaration(name, `constant ${name} of ${classLabelOf(declaration.classDeclaration)}`, {
        kind: 'member',
        memberKind: 'constant',
        name,
        declaringClassNames: [declaration.classDeclaration.fullyQualifiedName],
      })
    }
    case 'function': {
      const name = declaration.functionScope.name ?? ''

      return onDeclaration(name, `function ${name}`, { kind: 'function', name })
    }
    case 'parameter': {
      const { name } = declaration.parameter

      return onDeclaration(name, `parameter ${name}`, {
        kind: 'variable',
        name,
        functionScope: declaration.functionScope,
        declarationTokenIndex: declaration.parameter.tokenIndex,
      })
    }
    default: {
      const unhandledDeclaration: never = declaration

      return unhandledDeclaration
    }
  }
}

async function resolveClassReference(
  project: PhpProject,
  outline: PhpFileOutline,
  click: Extract<PhpClick, { kind: 'classReference' }>,
): Promise<PhpResolution> {
  const shortName = shortNameOf(click.fullyQualifiedName)
  const located = await project.locateClass(click.fullyQualifiedName, outline.path)
  const kindWord = located === null ? 'class' : CLASS_KIND_WORDS[located.classDeclaration.kind]
  const isGlobalName = !click.fullyQualifiedName.includes('\\')
  const missingNote = isGlobalName ? `${shortName} is a PHP built-in class` : `No file declares ${click.fullyQualifiedName}`

  return {
    outline,
    symbol: symbolOf(outline, click.range, shortName, `${kindWord} ${shortName}`),
    subject: { kind: 'class', fullyQualifiedName: click.fullyQualifiedName },
    targets: located === null ? [] : [targetOfClass(project, located.outline, located.classDeclaration)],
    isOnDeclaration: false,
    note: located === null ? missingNote : null,
  }
}

async function candidatesOfMember(
  project: PhpProject,
  outline: PhpFileOutline,
  memberKind: PhpMemberKind,
  name: string,
): Promise<{ targets: NavigationTarget[]; note: string | null }> {
  const candidates = rankedMemberCandidates(project, outline, memberKind, name).slice(0, MAXIMUM_CANDIDATES)
  if (candidates.length > 0) {
    const targets = await Promise.all(
      candidates.map(candidate => targetOfSymbolEntry(project, candidate, memberLabelOf(candidate.container ?? '', memberKind, name), 'candidate')),
    )

    return { targets, note: null }
  }
  switch (memberKind) {
    case 'method': {
      const dependencyTargets = await dependencyDeclarationsNamed(project, outline.path, name, true)
      const missingNote = `${name} is not declared in the project or its dependencies: a PHP built-in method, or a magic one`

      return { targets: dependencyTargets, note: dependencyTargets.length === 0 ? missingNote : null }
    }
    case 'property': {
      const propertyTargets = await propertyDeclarationsNamed(project, name)

      const missingNote = `No declaration of the property ${name} was found in the project`

      return { targets: propertyTargets, note: propertyTargets.length === 0 ? missingNote : null }
    }
    case 'constant':
      return { targets: [], note: `No declaration of the constant ${name} was found in the project` }
    default: {
      const unhandledKind: never = memberKind

      return unhandledKind
    }
  }
}

async function resolveMemberOfTypes(
  project: PhpProject,
  outline: PhpFileOutline,
  range: PhpNameRange,
  memberKinds: readonly PhpMemberKind[],
  name: string,
  receiverType: PhpType,
): Promise<PhpResolution> {
  const receiverClassNames = classMembersOf(receiverType).map(member => member.name)
  const [firstMemberKind = 'method'] = memberKinds
  const exactTargets: NavigationTarget[] = []
  const declaringClassNames: string[] = []
  const unlocatedClassNames: string[] = []
  let foundMemberKind: PhpMemberKind = firstMemberKind
  let declaringClassLabel: string | null = null
  for (const receiverClassName of receiverClassNames.slice(0, MAXIMUM_RECEIVER_CLASSES)) {
    for (const memberKind of memberKinds) {
      const receiverMember: PhpTypeMember = { kind: 'class', name: receiverClassName, typeArguments: [] }
      const outcome = await firstMemberInLineage(project, receiverMember, outline.path, memberKind, name)
      unlocatedClassNames.push(...outcome.unlocatedClassNames)
      if (outcome.foundMember !== null) {
        const { classDeclaration } = outcome.foundMember.boundClass.located
        exactTargets.push(targetOfFoundMember(project, outcome.foundMember, 'exact'))
        declaringClassNames.push(classDeclaration.fullyQualifiedName)
        declaringClassLabel ??= classLabelOf(classDeclaration)
        foundMemberKind = memberKind
        break
      }
    }
  }
  if (exactTargets.length > 0) {
    return {
      outline,
      symbol: symbolOf(outline, range, name, `${foundMemberKind} ${name} of ${declaringClassLabel ?? ''}`),
      subject: { kind: 'member', memberKind: foundMemberKind, name, declaringClassNames: [...new Set(declaringClassNames)] },
      targets: uniqueTargets(exactTargets),
      isOnDeclaration: false,
      note: null,
    }
  }
  const symbol = symbolOf(outline, range, name, `${firstMemberKind} ${name}`)
  const subject: PhpSubject = { kind: 'member', memberKind: firstMemberKind, name, declaringClassNames: [] }
  const withNote = (note: string): PhpResolution => ({ outline, symbol, subject, targets: [], isOnDeclaration: false, note })
  if (ENUM_BUILT_IN_MEMBERS.has(name)) {
    for (const receiverClassName of receiverClassNames) {
      const receiver = await project.locateClass(receiverClassName, outline.path)
      if (receiver?.classDeclaration.kind === 'enum') {
        return withNote(`${name} is built into every PHP enum`)
      }
    }
  }
  const builtInClassNames = [...new Set(unlocatedClassNames.filter(unlocatedClassName => !unlocatedClassName.includes('\\')))]
  const [builtInClassName] = builtInClassNames
  if (builtInClassName !== undefined) {
    return withNote(
      builtInClassNames.length === 1
        ? `${name} belongs to ${builtInClassName}, a PHP built-in class`
        : `${name} belongs to one of ${builtInClassNames.join(', ')}: PHP built-in classes`,
    )
  }
  if (isPhpOwnValue(receiverType)) {
    return withNote(`${name} is called on a value a PHP built-in class gives`)
  }
  const candidates = await candidatesOfMember(project, outline, firstMemberKind, name)

  return { outline, symbol, subject, targets: candidates.targets, isOnDeclaration: false, note: candidates.note }
}

async function resolveFunctionCall(
  project: PhpProject,
  outline: PhpFileOutline,
  click: Extract<PhpClick, { kind: 'functionCall' }>,
): Promise<PhpResolution> {
  const name = shortNameOf(click.writtenName)
  const symbol = symbolOf(outline, click.range, name, `function ${name}`)
  const subject: PhpSubject = { kind: 'function', name }
  const answer = (targets: NavigationTarget[], note: string | null): PhpResolution => ({
    outline,
    symbol,
    subject,
    targets,
    isOnDeclaration: false,
    note,
  })
  const declaration = await functionDeclarationNamed(project, outline, click.writtenName, click.tokenIndex)
  if (declaration !== null) {
    const { functionScope } = declaration

    return answer([targetAtToken(project, declaration.outline, functionScope.nameTokenIndex ?? functionScope.keywordTokenIndex, name, 'exact')], null)
  }
  const projectCandidates = project.workspace.symbolsNamed(name).filter(candidate => candidate.kind === 'function').slice(0, MAXIMUM_CANDIDATES)
  if (projectCandidates.length > 0) {
    return answer(await Promise.all(projectCandidates.map(candidate => targetOfSymbolEntry(project, candidate, name, 'candidate'))), null)
  }
  if (isBuiltInFunctionName(name)) {
    return answer([], `${name} is a PHP built-in function`)
  }
  const dependencyTargets = await dependencyDeclarationsNamed(project, outline.path, name, false)

  return answer(dependencyTargets, dependencyTargets.length === 0 ? `${name} is a PHP built-in function` : null)
}

async function resolveConstantReference(
  project: PhpProject,
  outline: PhpFileOutline,
  click: Extract<PhpClick, { kind: 'constantReference' }>,
): Promise<PhpResolution> {
  const name = shortNameOf(click.name)
  const declarations = project.workspace.symbolsNamed(name).filter(candidate => candidate.kind === 'constant' && candidate.container === null)
  const isWrittenAsConstant = /^[A-Z_][A-Z0-9_]*$/.test(name)
  if (declarations.length === 0 && !isWrittenAsConstant) {
    return { ...EMPTY_RESOLUTION, outline }
  }
  const certainty: TargetCertainty = declarations.length === 1 ? 'exact' : 'candidate'
  const targets = await Promise.all(
    declarations.slice(0, MAXIMUM_CANDIDATES).map(candidate => targetOfSymbolEntry(project, candidate, name, certainty)),
  )

  return {
    outline,
    symbol: symbolOf(outline, click.range, name, `constant ${name}`),
    subject: { kind: 'constant', name },
    targets,
    isOnDeclaration: false,
    note: targets.length === 0 ? `${name} is not declared in the project: a constant of PHP or of a dependency` : null,
  }
}

// Reads the click and follows it to the declarations it means. Shared by definition, usages and implementations.
export async function resolvePhpClick(project: PhpProject, position: CodePosition): Promise<PhpResolution> {
  const outline = await project.outlineOfFile(position.path)
  const offset = outline === null ? null : offsetOfLineAndColumn(outline.source.lineStartOffsets, position.line, position.column)
  if (outline === null || offset === null) {
    return EMPTY_RESOLUTION
  }
  const click = readPhpClick(outline, offset)
  switch (click.kind) {
    case 'none':
      return { ...EMPTY_RESOLUTION, outline }
    case 'declaration':
      return resolveDeclaration(outline, click.range, click.declaration)
    case 'classReference':
      return resolveClassReference(project, outline, click)
    case 'memberAccess': {
      const receiverType = await receiverTypeOfMemberAccess({ project, outline }, click.tokenIndex)

      return resolveMemberOfTypes(project, outline, click.range, [click.memberKind], click.name, receiverType)
    }
    case 'memberOfNamedClass':
      return resolveMemberOfTypes(project, outline, click.range, ['method', 'property', 'constant'], click.name, classType(click.fullyQualifiedName))
    case 'functionCall':
      return resolveFunctionCall(project, outline, click)
    case 'variable':
      return resolveVariable(project, outline, click)
    case 'constantReference':
      return resolveConstantReference(project, outline, click)
    default: {
      const unhandledClick: never = click

      return unhandledClick
    }
  }
}
