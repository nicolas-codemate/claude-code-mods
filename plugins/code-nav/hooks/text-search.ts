export type TextMatch = { line: number; column: number }

// Typed all in lower case a text matches whatever the case, as ripgrep's smart case and an editor's search do; with a
// capital letter it matches that case only.
export function isCaseSensitiveText(text: string): boolean {
  return text !== text.toLowerCase()
}

// Where a text is written in the lines of one file, in reading order, in the case the text asks for.
export function textMatchesInLines(lines: readonly string[], text: string, limit: number): { matches: TextMatch[]; isTruncated: boolean } {
  const matches: TextMatch[] = []
  if (text === '') {
    return { matches, isTruncated: false }
  }
  const isCaseSensitive = isCaseSensitiveText(text)
  const searchedText = isCaseSensitive ? text : text.toLowerCase()
  for (const [lineIndex, lineText] of lines.entries()) {
    const searchedLine = isCaseSensitive ? lineText : lineText.toLowerCase()
    for (let column = searchedLine.indexOf(searchedText); column !== -1; column = searchedLine.indexOf(searchedText, column + searchedText.length)) {
      if (matches.length === limit) {
        return { matches, isTruncated: true }
      }
      matches.push({ line: lineIndex + 1, column })
    }
  }

  return { matches, isTruncated: false }
}

// The first match at or below the first line shown, else the first of the file: where a search lands.
export function firstMatchIndexFrom(matches: readonly TextMatch[], topLine: number): number {
  const indexBelow = matches.findIndex(match => match.line >= topLine)

  return indexBelow === -1 ? 0 : indexBelow
}
