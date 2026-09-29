import type { Sex } from './tree'

// Russian naming helpers used to prefill new relatives. Every result is a suggestion the user can edit.

const patronymicExceptions: Record<string, [male: string, female: string]> = {
  'пётр': ['Петрович', 'Петровна'], 'петр': ['Петрович', 'Петровна'],
  'лев': ['Львович', 'Львовна'], 'павел': ['Павлович', 'Павловна'],
  'михаил': ['Михайлович', 'Михайловна'], 'яков': ['Яковлевич', 'Яковлевна'],
  'илья': ['Ильич', 'Ильинична'], 'фома': ['Фомич', 'Фоминична'],
  'кузьма': ['Кузьмич', 'Кузьминична'], 'лука': ['Лукич', 'Лукинична'],
  'савва': ['Саввич', 'Саввична'], 'никита': ['Никитич', 'Никитична'],
  'гаврила': ['Гаврилович', 'Гавриловна'], 'данила': ['Данилович', 'Даниловна'],
  'иона': ['Ионович', 'Ионовна'], 'самуил': ['Самуилович', 'Самуиловна'],
}

const commonMaleNames = [
  'Александр', 'Алексей', 'Анатолий', 'Андрей', 'Антон', 'Аркадий', 'Арсений', 'Артём', 'Афанасий', 'Богдан', 'Борис',
  'Вадим', 'Валентин', 'Валерий', 'Василий', 'Вениамин', 'Виктор', 'Виталий', 'Владимир', 'Владислав', 'Всеволод', 'Вячеслав',
  'Гавриил', 'Гаврила', 'Геннадий', 'Георгий', 'Герман', 'Глеб', 'Гордей', 'Григорий', 'Давид', 'Даниил', 'Данила', 'Демьян',
  'Денис', 'Дмитрий', 'Евгений', 'Евдоким', 'Евсей', 'Егор', 'Елисей', 'Емельян', 'Ефим', 'Захар', 'Иван', 'Игнат', 'Игнатий',
  'Игорь', 'Илья', 'Иннокентий', 'Иосиф', 'Исаак', 'Капитон', 'Карп', 'Кирилл', 'Климент', 'Константин', 'Кузьма', 'Лаврентий',
  'Лазарь', 'Лев', 'Леонид', 'Леонтий', 'Лука', 'Макар', 'Максим', 'Марк', 'Мартын', 'Матвей', 'Митрофан', 'Михаил', 'Моисей',
  'Назар', 'Нестор', 'Никита', 'Никифор', 'Никодим', 'Николай', 'Олег', 'Осип', 'Остап', 'Павел', 'Пантелей', 'Пётр', 'Платон',
  'Порфирий', 'Прокофий', 'Прохор', 'Родион', 'Роман', 'Руслан', 'Савва', 'Савелий', 'Семён', 'Серафим', 'Сергей', 'Спиридон',
  'Станислав', 'Степан', 'Тарас', 'Терентий', 'Тимофей', 'Тихон', 'Трофим', 'Фаддей', 'Фёдор', 'Феликс', 'Филипп', 'Фома',
  'Фрол', 'Харитон', 'Эдуард', 'Юлиан', 'Юрий', 'Яков', 'Ярослав',
]

const vowels = 'аеёиоуыэюя'
const hissing = 'жшчщц'

function capitalize(value: string): string {
  return value ? value[0].toLocaleUpperCase('ru') + value.slice(1) : value
}

/** Derives a patronymic from a father's given name: Пётр → Петрович/Петровна. */
export function patronymicFrom(fatherName: string, sex: Sex): string {
  const name = fatherName.trim().split(/\s+/)[0] ?? ''
  if (!/^[А-ЯЁа-яё-]{2,}$/.test(name)) return ''
  const lower = name.toLocaleLowerCase('ru')
  const female = sex === 'F'
  const exception = patronymicExceptions[lower]
  if (exception) return exception[female ? 1 : 0]
  let stem: string
  let male: string
  let fem: string
  if (/ий$/.test(lower)) {
    stem = lower.slice(0, -2)
    const clustered = stem.length >= 2 && !vowels.includes(stem.at(-1)!) && !vowels.includes(stem.at(-2)!)
    ;[male, fem] = clustered ? ['иевич', 'иевна'] : ['ьевич', 'ьевна']
  } else if (/[еаоуэюя]й$/.test(lower)) {
    stem = lower.slice(0, -1)
    ;[male, fem] = ['евич', 'евна']
  } else if (lower.endsWith('ь')) {
    stem = lower.slice(0, -1)
    ;[male, fem] = ['евич', 'евна']
  } else if (/[ая]$/.test(lower)) {
    stem = lower.slice(0, -1)
    ;[male, fem] = ['ич', 'ична']
  } else if (hissing.includes(lower.at(-1)!)) {
    stem = lower
    ;[male, fem] = ['евич', 'евна']
  } else if (vowels.includes(lower.at(-1)!)) {
    return ''
  } else {
    stem = lower
    ;[male, fem] = ['ович', 'овна']
  }
  return capitalize(stem + (female ? fem : male))
}

const fatherByPatronymic = new Map<string, string>()
for (const name of commonMaleNames) for (const sex of ['M', 'F'] as const) {
  const patronymic = patronymicFrom(name, sex).toLocaleLowerCase('ru')
  if (patronymic && !fatherByPatronymic.has(patronymic)) fatherByPatronymic.set(patronymic, name)
}

/** Guesses a father's given name from a patronymic: Петровна → Пётр. Returns '' when unsure. */
export function fatherNameFromPatronymic(patronymic: string): string {
  const lower = patronymic.trim().toLocaleLowerCase('ru')
  if (!lower) return ''
  const known = fatherByPatronymic.get(lower)
  if (known) return known
  const regular = /^([а-яё-]+[^аеёиоуыэюяьй])(?:ович|овна)$/.exec(lower)
  return regular ? capitalize(regular[1]) : ''
}

/** Converts a patronymic to the other sex: Петрович ↔ Петровна. */
export function patronymicForSex(patronymic: string, sex: Sex): string {
  if (!patronymic || sex === 'U') return patronymic
  const father = fatherNameFromPatronymic(patronymic)
  if (father) return patronymicFrom(father, sex)
  const lower = patronymic.toLocaleLowerCase('ru')
  const swaps: [RegExp, string, string][] = [[/(ов|ев)ич$/, 'ич', 'на'], [/(ов|ев)на$/, 'на', 'ич'], [/ична$/, 'ична', 'ич'], [/ич$/, 'ич', 'ична']]
  for (const [pattern, from, to] of swaps) {
    if (!pattern.test(lower)) continue
    const isFemale = /на$/.test(lower)
    if ((sex === 'F') === isFemale) return patronymic
    return patronymic.slice(0, -from.length) + to
  }
  return patronymic
}

/** Adapts a Russian surname to a sex: Иванов ↔ Иванова, Тверской ↔ Тверская. Unknown forms are returned unchanged. */
export function surnameForSex(surname: string, sex: Sex): string {
  const value = surname.trim()
  if (!value || sex === 'U' || !/[а-яё]$/i.test(value)) return value
  const lower = value.toLocaleLowerCase('ru')
  if (sex === 'F') {
    if (/(ов|ев|ёв|ин|ын)$/.test(lower)) return value + 'а'
    if (/(ск|цк)ий$/.test(lower)) return value.slice(0, -2) + 'ая'
    if (/(ск|цк)ой$/.test(lower)) return value.slice(0, -2) + 'ая'
    return value
  }
  if (/(ов|ев|ёв|ин|ын)а$/.test(lower)) return value.slice(0, -1)
  if (/(ск|цк)ая$/.test(lower)) return value.slice(0, -2) + 'ий'
  return value
}

const patronymicPattern = /^(?:(.+?)\s+)?([А-ЯЁ][а-яё]+(?:ович|евич|овна|евна|ич|ична|инична))$/u

/**
 * Splits "Иван Петрович" into given name and patronymic when the last word looks like a patronymic.
 * A lone patronymic ("Петрович", name unknown) is recognized too; single words ending in -ич must be
 * at least 5 letters so short given names are not mistaken for patronymics.
 */
export function splitPatronymic(given: string): { givenName: string; patronymic: string } {
  const match = patronymicPattern.exec(given.trim())
  if (!match || (!match[1] && match[2].length < 5)) return { givenName: given.trim(), patronymic: '' }
  return { givenName: match[1] ?? '', patronymic: match[2] }
}

const genitiveExceptions: Record<string, string> = { 'пётр': 'Петра', 'петр': 'Петра', 'павел': 'Павла', 'лев': 'Льва' }

/** Genitive case of a Russian given name for phrases like "сын Ивана и Анны". Non-Russian names are unchanged. */
export function genitiveName(name: string, sex: Sex): string {
  const value = name.trim()
  if (!/^[А-ЯЁа-яё-]+$/.test(value)) return value
  const lower = value.toLocaleLowerCase('ru')
  if (genitiveExceptions[lower]) return genitiveExceptions[lower]
  const last = lower.at(-1)!
  const stem = value.slice(0, -1)
  if (last === 'а') return stem + (/[гкхжшщч]$/.test(stem) ? 'и' : 'ы')
  if (last === 'я') return stem + 'и'
  if (last === 'ь') return stem + (sex === 'F' ? 'и' : 'я')
  if (last === 'й') return stem + 'я'
  if (sex === 'F' || vowels.includes(last)) return value
  return value + 'а'
}
