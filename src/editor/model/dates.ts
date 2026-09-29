// Converts between free-text dates and GEDCOM date values.
// The model always stores GEDCOM values; the UI shows them in the current language
// and accepts Russian or English input in either language.
import { getLocale, type Locale } from '../../shared/i18n'

const gedcomMonths = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const genitiveMonths = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const nominativeMonths = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const englishMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthStems: [RegExp, number][] = [
  [/^янв/, 0], [/^фев/, 1], [/^мар/, 2], [/^апр/, 3], [/^ма[йяю]/, 4], [/^июн/, 5], [/^июл/, 6], [/^авг/, 7], [/^сен/, 8], [/^окт/, 9], [/^ноя/, 10], [/^дек/, 11],
  [/^jan/, 0], [/^feb/, 1], [/^mar/, 2], [/^apr/, 3], [/^may/, 4], [/^jun/, 5], [/^jul/, 6], [/^aug/, 7], [/^sep/, 8], [/^oct/, 9], [/^nov/, 10], [/^dec/, 11],
]
const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export type GedcomVersion = '5.5.1' | '7.0'
export interface ParsedDate { value: string; recognized: boolean }

function monthIndex(word: string): number | undefined {
  return monthStems.find(([pattern]) => pattern.test(word))?.[1]
}

/** Parses one calendar date (no qualifier) into GEDCOM "D MON YYYY", "MON YYYY" or "YYYY". */
function parseSimple(text: string): string | undefined {
  let match = /^(\d{1,2})[./](\d{1,2})[./](\d{3,4})$/.exec(text)
  if (match) return formatParts(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  match = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) return formatParts(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  match = /^(\d{1,2})[./](\d{3,4})$/.exec(text)
  if (match) return formatParts(undefined, Number(match[1]) - 1, Number(match[2]))
  match = /^(?:(\d{1,2})\s+)?([а-яa-z]+)\.?\s+(\d{3,4})$/.exec(text)
  if (match) {
    const month = monthIndex(match[2])
    return month === undefined ? undefined : formatParts(match[1] ? Number(match[1]) : undefined, month, Number(match[3]))
  }
  match = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{3,4})$/.exec(text)
  if (match) {
    const month = monthIndex(match[1])
    return month === undefined ? undefined : formatParts(Number(match[2]), month, Number(match[3]))
  }
  match = /^(\d{3,4})$/.exec(text)
  if (match) return String(Number(match[1]))
  return undefined
}

function formatParts(day: number | undefined, month: number, year: number): string | undefined {
  if (!Number.isInteger(month) || month < 0 || month > 11 || year < 1 || year > 9999) return undefined
  if (day !== undefined && (day < 1 || day > daysInMonth[month])) return undefined
  return [day, gedcomMonths[month], year].filter((part) => part !== undefined).join(' ')
}

const gedcomSimple = String.raw`(?:(?:\d{1,2} )?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) )?\d{3,4}(?: BCE)?`
const gedcomDate = new RegExp(String.raw`^(?:(?:@#D[A-Z ]+@|JULIAN|GREGORIAN) )?(?:(?:ABT|CAL|EST|BEF|AFT) ${gedcomSimple}|BET ${gedcomSimple} AND ${gedcomSimple}|FROM ${gedcomSimple}(?: TO ${gedcomSimple})?|TO ${gedcomSimple}|${gedcomSimple})$`)

/**
 * Parses user input such as "ок. 1900", "12.03.1900", "до 1917", "между 1890 и 1895", "1890–1895" or "5 мая 1880 ст. ст.",
 * and the English forms "abt. 1900", "before 1917", "between 1890 and 1895", "12 Mar 1880 (O.S.)", "March 12, 1880".
 * Already valid GEDCOM values pass through. Unrecognized text is kept as typed and flagged.
 */
export function parseDateInput(input: string, version: GedcomVersion = '5.5.1'): ParsedDate {
  const raw = input.trim().replace(/\s+/g, ' ')
  if (!raw) return { value: '', recognized: true }
  if (gedcomDate.test(raw.toUpperCase()) && /^[A-Za-z@0-9]/.test(raw) && !/^\d{1,2}[./]/.test(raw)) return { value: raw.toUpperCase(), recognized: true }
  let text = raw.toLocaleLowerCase('ru').replaceAll('ё', 'е')
  let julian = false
  text = text.replace(/\(?\s*(?:(?:по\s+)?ст\.?\s*ст\.?|o\.\s*s\.|old style|julian)\s*\)?$/, () => { julian = true; return '' }).trim()
  text = text.replace(/\s*(?:г\.|гг\.|года|год|г)$/, '').trim()
  let qualifier = ''
  const qualifiers: [RegExp, string][] = [
    [/^(?:около|приблизительно|примерно|прибл\.?|ок\.?|~|≈|ca(?!l)\.?|c\.|about\s|abt\.?|approx\.?\s|circa\s|around\s)\s*/, 'ABT'],
    [/^(?:до|ранее|не позднее|<|before\s|bef\.?)\s*/, 'BEF'],
    [/^(?:после|позднее|позже|не ранее|>|after\s|aft\.?)\s*/, 'AFT'],
    [/^(?:расч\.?|вычисл\.?|calculated\s|calc\.?)\s*/, 'CAL'],
    [/^(?:предположительно|оцен\.?|предп\.?|estimated\s|est\.?)\s*/, 'EST'],
  ]
  for (const [pattern, code] of qualifiers) if (pattern.test(text)) { qualifier = code; text = text.replace(pattern, ''); break }
  text = text.replace(/\s*(?:г\.|гг\.|года|год|г)$/, '').trim()
  let core: string | undefined
  const between = /^(?:(?:между|between)\s+)?(.+?)\s*(?:\s+(?:и|and)\s+|\s*[-–—]\s*)(.+)$/.exec(text)
  const period = /^(?:с|from)\s+(.+?)(?:\s+(?:по|to)\s+(.+))?$/.exec(text)
  if (!qualifier && period) {
    const from = parseSimple(period[1].replace(/\s*г\.?$/, ''))
    const to = period[2] ? parseSimple(period[2].replace(/\s*г\.?$/, '')) : undefined
    if (from && (to || !period[2])) core = to ? `FROM ${from} TO ${to}` : `FROM ${from}`
  } else if (!qualifier && between && !/^\d{3,4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const first = parseSimple(between[1].replace(/\s*г\.?$/, ''))
    const second = parseSimple(between[2].replace(/\s*г\.?$/, ''))
    if (first && second) core = `BET ${first} AND ${second}`
  }
  if (!core) {
    const simple = parseSimple(text)
    if (simple) core = qualifier ? `${qualifier} ${simple}` : simple
  }
  if (!core) return { value: raw, recognized: false }
  if (julian) core = `${version === '7.0' ? 'JULIAN' : '@#DJULIAN@'} ${core}`
  return { value: core, recognized: true }
}

function formatSimple(value: string, locale: Locale): string {
  const parts = value.split(' ')
  if (locale === 'en') {
    if (parts.length === 3) return `${Number(parts[0])} ${englishMonths[gedcomMonths.indexOf(parts[1])]} ${parts[2]}`
    if (parts.length === 2) return `${englishMonths[gedcomMonths.indexOf(parts[0])]} ${parts[1]}`
    return value
  }
  if (parts.length === 3) return `${Number(parts[0])} ${genitiveMonths[gedcomMonths.indexOf(parts[1])]} ${parts[2]}`
  if (parts.length === 2) return `${nominativeMonths[gedcomMonths.indexOf(parts[0])]} ${parts[1]}`
  return value
}

/** Words of a formatted date per language. */
const dateWords: Record<Locale, { qualifiers: Record<string, string>; between: [string, string]; from: string; to: string; julian: string }> = {
  ru: { qualifiers: { ABT: 'ок.', CAL: 'расч.', EST: 'оцен.', BEF: 'до', AFT: 'после' }, between: ['между', 'и'], from: 'с', to: 'по', julian: ' ст. ст.' },
  en: { qualifiers: { ABT: 'abt.', CAL: 'calc.', EST: 'est.', BEF: 'bef.', AFT: 'aft.' }, between: ['between', 'and'], from: 'from', to: 'to', julian: ' (O.S.)' },
}

/**
 * Formats a GEDCOM date for display: "ABT 1900" → "ок. 1900" / "abt. 1900", "12 MAR 1900" → "12 марта 1900" / "12 Mar 1900".
 * Unknown values are returned as-is.
 */
export function formatDate(value: string, locale: Locale = getLocale()): string {
  const words = dateWords[locale]
  const raw = value.trim()
  if (!raw) return ''
  if (!gedcomDate.test(raw)) return /^\(.*\)$/.test(raw) ? raw.slice(1, -1) : raw
  let text = raw
  let suffix = ''
  const calendar = /^(?:@#D([A-Z ]+)@|(JULIAN|GREGORIAN)) /.exec(text)
  if (calendar) {
    text = text.slice(calendar[0].length)
    if ((calendar[1] ?? calendar[2]).trim() === 'JULIAN') suffix = words.julian
  }
  const simple = new RegExp(`^${gedcomSimple}$`)
  let match: RegExpExecArray | null
  let result: string
  if ((match = /^(ABT|CAL|EST|BEF|AFT) (.+)$/.exec(text))) {
    result = `${words.qualifiers[match[1]]} ${formatSimple(match[2], locale)}`
  } else if ((match = /^BET (.+) AND (.+)$/.exec(text))) result = `${words.between[0]} ${formatSimple(match[1], locale)} ${words.between[1]} ${formatSimple(match[2], locale)}`
  else if ((match = /^FROM (.+?)(?: TO (.+))?$/.exec(text))) result = match[2] ? `${words.from} ${formatSimple(match[1], locale)} ${words.to} ${formatSimple(match[2], locale)}` : `${words.from} ${formatSimple(match[1], locale)}`
  else if ((match = /^TO (.+)$/.exec(text))) result = `${words.to} ${formatSimple(match[1], locale)}`
  else result = simple.test(text) ? formatSimple(text, locale) : text
  return result + suffix
}

/** First year mentioned in a date value, for sorting and consistency checks. */
export function yearOf(value: string): number | undefined {
  const match = /(?:^|\D)(\d{3,4})(?!\d)/.exec(value)
  return match ? Number(match[1]) : undefined
}

/** Compact year for cards: "ABT 1900" → "≈1900", "BEF 1917" → "<1917". */
export function shortYear(value: string): string {
  const year = yearOf(value)
  if (year === undefined) return value.trim() ? '?' : ''
  if (/\b(?:ABT|CAL|EST|BET)\b/.test(value)) return `≈${year}`
  if (/\bBEF\b/.test(value)) return `<${year}`
  if (/\bAFT\b/.test(value)) return `>${year}`
  return String(year)
}

/** Whether a stored value is a GEDCOM date the app understands. */
export function isRecognizedDate(value: string): boolean {
  return !value.trim() || gedcomDate.test(value.trim())
}
