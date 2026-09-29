import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IntlMessageFormat } from 'intl-messageformat'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

type Catalog = { [key: string]: string | Catalog }

function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') result.set(path, value)
    else for (const [nested, text] of flatten(value, path)) result.set(nested, text)
  }
  return result
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

const russian = flatten(ru as Catalog)
const english = flatten(en as Catalog)
const src = new URL('../../', import.meta.url).pathname

describe('message catalogs', () => {
  it('have the same keys in every language', () => {
    expect([...english.keys()].filter((key) => !russian.has(key))).toEqual([])
    expect([...russian.keys()].filter((key) => !english.has(key))).toEqual([])
  })

  it('are valid ICU messages', () => {
    for (const [locale, catalog] of [['ru', russian], ['en', english]] as const) {
      for (const [key, message] of catalog) expect(() => new IntlMessageFormat(message, locale), `${locale}: ${key}`).not.toThrow()
    }
  })

  it('have a message for every error code the editor throws', () => {
    const codes = new Set<string>()
    for (const file of sources(join(src, 'editor'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/AppError\('(\w+)'/g)) codes.add(match[1]!)
      for (const match of text.matchAll(/errorFromData\([^,]+, '(\w+)'\)/g)) codes.add(match[1]!)
      for (const match of text.matchAll(/'(fatherExists|motherExists)'/g)) codes.add(match[1]!)
    }
    expect(codes.size).toBeGreaterThan(40)
    expect([...codes].filter((code) => !russian.has(`editor.errors.${code}`))).toEqual([])
  })

  it('have a message for every error code the visualizer throws', () => {
    const codes = new Set<string>()
    for (const file of sources(join(src, 'viewer'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/AppError\('(\w+)'/g)) codes.add(match[1]!)
    }
    expect(codes.size).toBeGreaterThan(3)
    expect([...codes].filter((code) => !russian.has(`viewer.errors.${code}`))).toEqual([])
  })
})
