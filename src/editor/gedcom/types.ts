export interface GedcomSource {
  /** Unmodified decoded input, including its BOM and original line endings. */
  text: string
  fileName: string
  version: '5.5.1' | '7.0'
  encoding: 'UTF-8' | 'ASCII'
  /** Import notes shown in «Issues». Plain strings are notes stored by earlier versions. */
  warnings: GedcomWarning[]
}

/** An import note: a message code of `editor.gedcomWarnings` and its values. */
export type GedcomWarning = string | { code: string; values: Record<string, string | number> }

export interface GedcomLine {
  index: number
  raw: string
  ending: string
  level: number
  xref?: string
  tag: string
  value: string
  parent?: GedcomLine
  children: GedcomLine[]
}

export interface ParsedGedcom {
  lines: GedcomLine[]
  records: GedcomLine[]
  recordsById: Map<string, GedcomLine>
  version: GedcomSource['version']
  encoding: GedcomSource['encoding']
  bom: string
  ending: string
}
