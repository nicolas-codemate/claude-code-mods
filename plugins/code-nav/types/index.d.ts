// Lines are numbered from 1 as an editor shows them; a column is an index into the line's own text, from 0, tabs
// counted as one character. Paths are relative to the project root, with forward slashes, files git ignores included
// (a dependency under vendor/ or node_modules/ keeps its path from the root).

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'trait'
  | 'enum'
  | 'function'
  | 'method'
  | 'constant'
  | 'property'
  | 'type'
  | 'variable'
  // A part of a file that is not code: a heading of a document, a key of a configuration file, a rule of a
  // stylesheet, a target of a makefile.
  | 'section'

// One declaration of the project, as the index lists it. A member names the class, interface, trait or enum holding it.
export type SymbolEntry = {
  name: string
  kind: SymbolKind
  path: string
  line: number
  container: string | null
}

export type CodePosition = { path: string; line: number; column: number }

// The name under a click: where it stands in its line and what it was read as ("method save of OrderRepository").
export type ClickedSymbol = { name: string; line: number; startColumn: number; endColumn: number; description: string }

// exact: the analysis followed the types or the imports to this declaration. candidate: a declaration of that name
// the analysis could not tell apart from the others.
export type TargetCertainty = 'exact' | 'candidate'

export type NavigationTarget = CodePosition & {
  // What the place is, short enough for one row of a list: "OrderRepository::save".
  label: string
  // The declaration's own line, trimmed.
  preview: string
  certainty: TargetCertainty
  // The file is not part of the project's own sources: a dependency git ignores.
  isDependency: boolean
}

export type DefinitionAnswer = {
  symbol: ClickedSymbol | null
  targets: NavigationTarget[]
  // The click landed on the declaration itself: the pane then lists the usages instead of going nowhere.
  isOnDeclaration: boolean
  // Said to the person when there is nowhere to go: "count is a PHP built-in function".
  note: string | null
}

// confirmed: the analysis proved the usage refers to the symbol. unverified: the name matches and the receiver's
// type could not be read, so it may belong to another class.
export type UsageCertainty = 'confirmed' | 'unverified'

export type Usage = CodePosition & { preview: string; certainty: UsageCertainty }

export type UsagesAnswer = {
  symbol: ClickedSymbol | null
  // What is searched, as a title: "OrderRepository::save".
  title: string
  usages: Usage[]
  // More matches existed than the analysis read.
  isTruncated: boolean
  note: string | null
}

export type ImplementationsAnswer = {
  symbol: ClickedSymbol | null
  title: string
  targets: NavigationTarget[]
  note: string | null
}

export type PaletteItemKind = 'file' | 'symbol' | 'line'

// One row of the search palette. matchedIndexes are the characters of label the query matched, to light them.
export type PaletteItem = {
  kind: PaletteItemKind
  symbolKind: SymbolKind | null
  label: string
  detail: string
  matchedIndexes: number[]
  path: string
  line: number
}

// How a piece of source text is colored. A name is an identifier with no more specific reading.
export type TokenKind =
  | 'keyword'
  | 'name'
  | 'variable'
  | 'typeName'
  | 'callName'
  | 'property'
  | 'string'
  | 'comment'
  | 'number'
  | 'punctuation'
  | 'tag'
  | 'attribute'
  | 'text'

// One colored piece of a line: columns index the line's own text, endColumn excluded. A navigable token is a name a
// click may look up (an identifier in code, a class name in a documentation tag), never a keyword or plain prose.
export type SourceToken = { startColumn: number; endColumn: number; kind: TokenKind; isNavigable: boolean }

// A place the pane showed, to come back to: the file, its first shown line and the line that was pointed at.
export type ViewedPlace = { path: string; topLine: number; markedLine: number | null }

export type NavigationHistory = { places: ViewedPlace[]; index: number }

// The name the pane points at: the declaration a jump landed on, or the name last clicked. Usages and
// implementations are asked about it.
export type MarkedSymbol = { path: string; line: number; startColumn: number; endColumn: number }

export type ResultsKind = 'definitions' | 'usages' | 'implementations' | 'parents' | 'textSearch' | 'bookmarks'

export type ResultRowMark = 'exact' | 'candidate' | 'confirmed' | 'unverified' | 'match'

export type ResultRow = {
  path: string
  line: number
  column: number
  // How many characters of the line the row is about, from column: the name found, or the text searched.
  matchLength: number
  label: string
  preview: string
  mark: ResultRowMark
  isDependency: boolean
}

// The list under the code: the declarations a name may refer to, its usages, its implementations, or the lines a
// text search found.
export type ResultsPanel = {
  kind: ResultsKind
  title: string
  rows: ResultRow[]
  selectedIndex: number | null
  firstShownIndex: number
  isTruncated: boolean
  note: string | null
  // The text looked for, on the lists of a text search; null on the lists about a name.
  searchedText: string | null
}

// The search of the files' own field: the files of the project whose path matches, in place of the tree while the
// field holds a text. Drawn as the palette's field is, a new field for each opening of the files.
export type FilesFilterState = { query: string; initialQuery: string; fieldNumber: number; selectedIndex: number; items: PaletteItem[] }

// everything: files, classes and methods of the project. outline: the declarations of the file shown.
// textSearch: a text looked for in the file shown or in every file. goToLine: a line number of the file shown.
export type PaletteMode = 'everything' | 'outline' | 'textSearch' | 'goToLine'

// Where a text is searched: the file shown, as it is typed, or every file of the project, on Enter.
export type TextSearchScope = 'file' | 'project'

export type PaletteState = {
  mode: PaletteMode
  // Read in the textSearch mode only.
  textScope: TextSearchScope
  query: string
  // What the field held when it was drawn first. The field is never drawn with another text afterwards: drawing
  // the text typed so far would put back a text one key late, over what the person has typed since.
  initialQuery: string
  selectedIndex: number
  // Each opening draws a field of its own key, so the keyboard never goes back to the field of an earlier opening.
  fieldNumber: number
  // The rows found for the text, set in the same write as the text so that one key draws the pane once.
  items: PaletteItem[]
}

// A line the person marked to come back to, with what it said when marked.
export type Bookmark = { path: string; line: number; preview: string }

// One declaration holding the line read, outermost first: where the reading stands in the file.
export type BreadcrumbStep = { name: string; kind: SymbolKind; line: number }

// A run of lines of one file: the lines the person selected in the pane.
export type SelectedPlace = { path: string; startLine: number; endLine: number }

export type IndexSummary = { fileCount: number; symbolCount: number; durationMs: number }

// A file open in a tab, and where it was left: the first line shown and the name pointed at.
export type OpenTab = { path: string; topLine: number; markedSymbol: MarkedSymbol | null }

export type TabsState = { tabs: OpenTab[]; activeIndex: number | null }

// A message about a name looked up, drawn under the name itself: no declaration, no usage, a name of PHP.
export type InlineNote = { path: string; line: number; column: number; text: string }

// drawer: the tabs or the files fold behind a button of the header, slide over the code when opened and fold back once
// one is picked. pinned: they keep a column of their own beside the code, the tabs left of it and the files right.
export type ColumnMode = 'drawer' | 'pinned'

export type KeyboardLayout = 'azerty' | 'qwerty' | 'unknown'

declare module 'claude-code' {
  interface PluginState {
    'code-nav': {
      projectRoot: string | null
      currentPath: string | null
      // The first line shown, from 1.
      topLine: number
      // Bumped when the text of the file shown is read again, so the pane is drawn again with it.
      fileRevision: number
      markedSymbol: MarkedSymbol | null
      history: NavigationHistory
      tabs: TabsState
      tabsMode: ColumnMode
      // How far the drawer of tabs is open, from 0 (folded) to 1, stepped while it slides.
      tabsDrawerOpenness: number
      explorerMode: ColumnMode
      // How far the drawer of files is open, from 0 (folded) to 1, stepped while it slides.
      drawerOpenness: number
      sidebarWidth: number
      explorerWidth: number
      // The directories of the explorer opened, by their path from the project root.
      expandedDirectories: string[]
      filesFilter: FilesFilterState
      // The first row of the explorer in sight.
      treeOffset: number
      // Bumped when a directory listing arrives, so the explorer is drawn again with it.
      treeRevision: number
      recentPaths: string[]
      // Files Claude read or wrote in this session, most recent first: offered with the recent files.
      touchedPaths: string[]
      palette: PaletteState | null
      resultsPanel: ResultsPanel | null
      // The selected row of the list under the code is previewed above the list, the file read staying in place.
      isPeekShown: boolean
      // Bumped when a file previewed has been read, so the preview is drawn again with it.
      peekRevision: number
      // Lines the wheel moved the preview by, from where it opens a few lines above the place.
      peekScrolledLines: number
      notice: string | null
      inlineNote: InlineNote | null
      // The lines of the file shown the person has selected with the mouse, sent to Claude with their next message.
      selectedLines: SelectedPlace | null
      // How many columns of the code are scrolled out of sight on the left.
      scrolledColumns: number
      bookmarks: Bookmark[]
      isHelpShown: boolean
      isIndexing: boolean
      indexSummary: IndexSummary | null
      keyboardLayout: KeyboardLayout
      claudeCodeTheme: string | null
      configuredTheme: string | null
      requestedPaneColumns: number
    }
  }
}
