import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importGedcomBytes, importGedcomText, parseGedcom } from './parser'
import { exportGedcom } from './serializer'
import { createSkeleton } from './skeleton'
import { createDemo } from '../model/demo'
import type { TreeDocument } from '../model/tree'
import { addChild, addParent, addPartner, addPerson, deletePerson, unlinkParent, updateFamily, updatePerson } from '../model/ops'

const fixture551 = readFileSync(new URL('../../../tests/fixtures/family-551.ged', import.meta.url), 'utf8')
const fixture7 = readFileSync(new URL('../../../tests/fixtures/family-7.ged', import.meta.url), 'utf8')
const bytes = (text: string) => new TextEncoder().encode(text).buffer

describe('source-preserving GEDCOM', () => {
  it.each([fixture551, fixture7, '\uFEFF' + fixture551.replaceAll('\n', '\r\n'), fixture7.replaceAll('\n', '\r').trimEnd()])('preserves an unchanged file byte-for-byte', (text) => {
    const tree = importGedcomBytes(bytes(text), 'fixture.ged')
    expect(exportGedcom(tree)).toBe(text)
    expect(new TextEncoder().encode(exportGedcom(tree))).toEqual(new TextEncoder().encode(text))
  })

  it('imports multiple marriages, adoption, names, and continuation text without discarding source data', () => {
    const tree = importGedcomText(fixture551)
    expect(Object.keys(tree.people)).toHaveLength(5)
    expect(Object.keys(tree.families)).toHaveLength(2)
    expect(tree.people.I1.givenName).toBe('John')
    expect(tree.people.I1.note).toBe('First line\nSecond line with me@example.com and more text\n\nLast line')
    expect(tree.gedcom?.text).toContain('2 PEDI adopted')
    expect(tree.gedcom?.warnings).toEqual([])
  })

  it('patches the first name and matching structured field while preserving every other line', () => {
    const tree = importGedcomText(fixture551)
    tree.people.I1.givenName = 'Albert'
    expect(exportGedcom(tree)).toBe(fixture551.replace('1 NAME Dr. John /Doe/ Jr.', '1 NAME Dr. Albert /Doe/ Jr.').replace('2 GIVN John', '2 GIVN Albert'))
    expect(importGedcomText(exportGedcom(tree)).people.I1.givenName).toBe('Albert')
  })

  it('patches a surname and birth date without modifying names, citations, or unsupported tags elsewhere', () => {
    const tree = importGedcomText(fixture7)
    tree.people.I1.surname = 'Орлов'
    tree.people.I1.birthDate = 'BET 1899 AND 1901'
    expect(exportGedcom(tree)).toBe(fixture7.replace('1 NAME Иван /Леснов/', '1 NAME Иван /Орлов/').replace('2 SURN Леснов', '2 SURN Орлов').replace('2 DATE ABT 1900', '2 DATE BET 1899 AND 1901'))
  })

  it.each([fixture551, fixture7])('rewrites note payload only, preserving note citations and shared records', (text) => {
    const tree = importGedcomText(text)
    const note = '@hello\n\nme@example.com\n' + 'Very long text with Кириллица and spaces. '.repeat(20)
    tree.people.I1.note = note
    const output = exportGedcom(tree)
    expect(importGedcomText(output).people.I1.note).toBe(note)
    expect(output).toContain('2 SOUR @S1@')
    const tail = text.slice(text.indexOf('0 @N1@'))
    expect(output).toContain(tail)
    if (tree.gedcom?.version === '5.5.1') {
      expect(output).toContain('2 CONC')
      for (const line of output.split('\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(255)
    } else {
      expect(output).toContain('1 NOTE @@hello')
      expect(output).not.toContain('2 CONC')
    }
  })

  it('adds missing supported structures and clears date values without erasing event facts or sources', () => {
    const tree = importGedcomText(fixture551)
    tree.people.I1.birthDate = ''
    tree.people.I1.deathDate = ''
    tree.people.I2.birthDate = '1902'
    tree.people.I2.note = 'New note'
    const output = exportGedcom(tree)
    const reimport = importGedcomText(output)
    expect(reimport.people.I1.birthDate).toBe('')
    expect(output).toContain('1 DEAT Y')
    expect(output).toContain('2 PLAC Lyon, France\n2 SOUR @S1@\n3 PAGE 42')
    expect(reimport.people.I2.birthDate).toBe('1902')
    expect(reimport.people.I2.note).toBe('New note')
  })

  it('keeps the original BOM and CRLF when editing', () => {
    const text = '\uFEFF' + fixture551.replaceAll('\n', '\r\n')
    const tree = importGedcomText(text)
    tree.people.I1.birthDate = '1901'
    expect(exportGedcom(tree)).toBe(text.replace('2 DATE ABT 1900', '2 DATE 1901'))
  })

  it('reports broken references without deleting them from the source', () => {
    const text = fixture7.replace('1 CHIL @I3@', '1 CHIL @MISSING@')
    const tree = importGedcomText(text)
    expect(tree.families.F1.childIds).toEqual([])
    expect(tree.gedcom?.warnings.length).toBeGreaterThan(0)
    expect(exportGedcom(tree)).toBe(text)
  })

  it('accepts shared ancestors and disconnected people without treating them as duplicate records', () => {
    const text = fixture7.replace('0 TRLR', '0 @F2@ FAM\n1 HUSB @I1@\n1 CHIL @I3@\n0 @I4@ INDI\n1 NAME Alone /Person/\n0 TRLR')
    const tree = importGedcomText(text)
    expect(Object.keys(tree.people)).toHaveLength(4)
    expect(tree.families.F2.childIds).toEqual(['I3'])
    expect(exportGedcom(tree)).toBe(text)
  })

  it('rejects duplicate IDs, invalid levels, ancestry cycles, and unsupported versions', () => {
    expect(() => importGedcomText(fixture7.replace('@I2@ INDI', '@I1@ INDI'))).toThrow('duplicateXref')
    expect(() => parseGedcom(fixture7.replace('1 SEX M', '4 SEX M'))).toThrow('badNesting')
    expect(() => importGedcomText(fixture7.replace('1 CHIL @I3@', '1 CHIL @I1@'))).toThrow('ancestryCycle')
    expect(() => parseGedcom(fixture7.replace('2 VERS 7.0', '2 VERS 5.5'))).toThrow('unsupportedVersion')
  })

  it('rejects unsupported encodings and malformed UTF-8 before importing', () => {
    expect(() => importGedcomBytes(bytes(fixture551.replace('1 CHAR UTF-8', '1 CHAR ANSEL')), 'test.ged')).toThrow(expect.objectContaining({ code: 'unsupportedCharset', params: { charset: 'ANSEL' } }))
    expect(() => importGedcomBytes(new Uint8Array([0xff, 0xfe, 0]).buffer, 'test.ged')).toThrow('utf16')
    expect(() => importGedcomBytes(new Uint8Array([0x80]).buffer, 'test.ged')).toThrow('invalidUtf8')
  })

  it('refuses ASCII-incompatible edits on export', () => {
    const tree = importGedcomText(fixture551.replace('1 CHAR UTF-8', '1 CHAR ASCII'))
    tree.people.I1.givenName = 'Иван'
    expect(() => exportGedcom(tree)).toThrow('asciiOverflow')
  })

  it('refuses to rewrite inconsistent structured names instead of damaging their prefixes', () => {
    const tree = importGedcomText(fixture551.replace('2 GIVN John', '2 GIVN Unrelated'))
    tree.people.I1.givenName = 'Changed'
    expect(() => exportGedcom(tree)).toThrow('nameMismatch')
  })
})

describe('structural GEDCOM export', () => {
  const trailer = '0 TRLR\n'
  // Partner order is not significant; export orders HUSB before WIFE.
  const families = (tree: TreeDocument) => Object.values(tree.families).map((family) => ({ ...family, partnerIds: [...family.partnerIds].sort() }))

  it('adds a child to an existing family with reciprocal links and no other changes', () => {
    const { tree, personId } = addChild(importGedcomText(fixture551), 'I1', 'F', 'F1')
    expect(personId).toBe('I6')
    const expected = fixture551
      .replace('1 CHIL @I3@\n', '1 CHIL @I3@\n1 CHIL @I6@\n')
      .replace(trailer, '0 @I6@ INDI\n1 NAME /Doe/\n2 SURN Doe\n1 SEX F\n1 FAMC @F1@\n' + trailer)
    const output = exportGedcom(tree)
    expect(output).toBe(expected)
    expect(importGedcomText(output).families.F1.childIds).toEqual(['I3', 'I6'])
  })

  it('deletes a person together with every pointer to the record', () => {
    const tree = deletePerson(importGedcomText(fixture551), 'I4')
    expect(exportGedcom(tree)).toBe(fixture551.replace('0 @I4@ INDI\n1 NAME Mary /Brown/\n1 FAMS @F2@\n', '').replace('1 WIFE @I4@\n', ''))
  })

  it('moves a child to a new single-parent family by touching only the affected link lines', () => {
    const tree = unlinkParent(importGedcomText(fixture551), 'I5', 'I1')
    expect(tree.families.F2.childIds).toEqual([])
    const expected = fixture551
      .replace('1 NAME Mary /Brown/\n1 FAMS @F2@\n', '1 NAME Mary /Brown/\n1 FAMS @F2@\n1 FAMS @F6@\n')
      .replace('1 NAME Robin /Doe/\n1 FAMC @F2@\n', '1 NAME Robin /Doe/\n1 FAMC @F6@\n')
      .replace('1 WIFE @I4@\n1 CHIL @I5@\n', '1 WIFE @I4@\n')
      .replace(trailer, '0 @F6@ FAM\n1 HUSB @I4@\n1 CHIL @I5@\n' + trailer)
    expect(exportGedcom(tree)).toBe(expected)
  })

  it('patches sex, places, marriage, and birth surname in place', () => {
    let tree = importGedcomText(fixture551)
    tree = updatePerson(tree, 'I4', { sex: 'F', birthSurname: 'Green', birthPlace: 'Paris' })
    tree = updatePerson(tree, 'I1', { deathPlace: 'Nice' })
    tree = updateFamily(tree, 'F1', { marriagePlace: 'Lyon' })
    tree = updateFamily(tree, 'F2', { marriageDate: 'ABT 1930' })
    const expected = fixture551
      .replace('1 NAME Mary /Brown/\n1 FAMS @F2@\n', '1 NAME Mary /Brown/\n1 NAME Mary /Green/\n2 TYPE birth\n2 SURN Green\n1 SEX F\n1 FAMS @F2@\n1 BIRT\n2 PLAC Paris\n')
      .replace('1 DEAT\n2 DATE BEF 1980\n', '1 DEAT\n2 DATE BEF 1980\n2 PLAC Nice\n')
      .replace('1 MARR\n2 DATE 1920\n', '1 MARR\n2 DATE 1920\n2 PLAC Lyon\n')
      .replace('1 CHIL @I5@\n', '1 CHIL @I5@\n1 MARR\n2 DATE ABT 1930\n')
    const output = exportGedcom(tree)
    expect(output).toBe(expected)
    const reimported = importGedcomText(output)
    expect(reimported.people.I4).toMatchObject({ sex: 'F', birthSurname: 'Green', birthPlace: 'Paris' })
    expect(reimported.families.F2.marriageDate).toBe('ABT 1930')
    tree = updatePerson(reimported, 'I4', { birthSurname: '' })
    expect(exportGedcom(tree)).toBe(output.replace('1 NAME Mary /Green/\n2 TYPE birth\n2 SURN Green\n', ''))
  })

  it('creates a Russian family from an empty skeleton and reads it back identically', () => {
    let tree = { schemaVersion: 2 as const, id: 'new', title: 'Новое', people: {}, families: {}, gedcom: createSkeleton(), nextIds: { person: 1, family: 1 } }
    let result = addPerson(tree, { givenName: 'Анна', patronymic: 'Петровна', surname: 'Иванова', birthSurname: 'Соколова', sex: 'F', birthDate: 'ABT 1900', birthPlace: 'Тверь' })
    const anna = result.personId!
    result = addParent(result.tree, anna, 'M')
    const father = result.personId!
    expect(result.tree.people[father]).toMatchObject({ givenName: 'Пётр', surname: 'Соколов', sex: 'M' })
    result = addPartner(result.tree, anna)
    expect(result.tree.people[result.personId!]).toMatchObject({ surname: 'Иванов', sex: 'M' })
    tree = updatePerson(result.tree, result.personId!, { givenName: 'Иван' })
    tree = updateFamily(tree, result.familyId!, { marriageDate: '12 MAR 1921', marriagePlace: 'Москва' })
    result = addChild(tree, anna, 'M')
    expect(result.tree.people[result.personId!]).toMatchObject({ surname: 'Иванов', patronymic: '' })
    const output = exportGedcom(result.tree)
    expect(output).toContain('0 @I1@ INDI\n1 NAME Анна Петровна /Иванова/\n2 GIVN Анна Петровна\n2 SURN Иванова\n1 NAME Анна Петровна /Соколова/\n2 TYPE birth\n2 SURN Соколова\n1 SEX F\n1 BIRT\n2 DATE ABT 1900\n2 PLAC Тверь\n1 FAMC @F1@\n1 FAMS @F2@\n')
    expect(output).toContain('0 @F2@ FAM\n1 HUSB @I3@\n1 WIFE @I1@\n1 CHIL @I4@\n1 MARR\n2 DATE 12 MAR 1921\n2 PLAC Москва\n0 TRLR\n')
    const reimported = importGedcomText(output)
    expect(reimported.people).toEqual(result.tree.people)
    expect(families(reimported)).toEqual(families(result.tree))
    expect(exportGedcom(reimported)).toBe(output)
  })

  it('round-trips a 1,000-person generated tree through export and import', () => {
    const tree = createDemo(1000)
    const output = exportGedcom(tree)
    const reimported = importGedcomText(output)
    expect(reimported.people).toEqual(tree.people)
    expect(families(reimported)).toEqual(families(tree))
    expect(exportGedcom(reimported)).toBe(output)
  })

  it('never reuses the ID of a deleted person for a new one', () => {
    const tree = deletePerson(importGedcomText(fixture551), 'I5')
    const { tree: next, personId } = addPerson(tree, { givenName: 'New' })
    expect(personId).toBe('I6')
    const output = exportGedcom(next)
    expect(output).not.toContain('@I5@')
    expect(output).toContain('0 @I6@ INDI\n1 NAME New\n2 GIVN New\n0 TRLR')
  })
})
