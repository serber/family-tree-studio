import { describe, expect, it } from 'vitest'
import { formatDate, parseDateInput, shortYear, yearOf } from './dates'
import { fatherNameFromPatronymic, genitiveName, patronymicForSex, patronymicFrom, splitPatronymic, surnameForSex } from './names'

describe('Russian names', () => {
  it.each([
    ['Иван', 'Иванович', 'Ивановна'], ['Пётр', 'Петрович', 'Петровна'], ['Сергей', 'Сергеевич', 'Сергеевна'],
    ['Николай', 'Николаевич', 'Николаевна'], ['Игорь', 'Игоревич', 'Игоревна'], ['Василий', 'Васильевич', 'Васильевна'],
    ['Дмитрий', 'Дмитриевич', 'Дмитриевна'], ['Георгий', 'Георгиевич', 'Георгиевна'], ['Юрий', 'Юрьевич', 'Юрьевна'],
    ['Илья', 'Ильич', 'Ильинична'], ['Никита', 'Никитич', 'Никитична'], ['Кузьма', 'Кузьмич', 'Кузьминична'],
    ['Михаил', 'Михайлович', 'Михайловна'], ['Лев', 'Львович', 'Львовна'], ['Павел', 'Павлович', 'Павловна'],
    ['Яков', 'Яковлевич', 'Яковлевна'], ['Фома', 'Фомич', 'Фоминична'],
  ])('derives patronymics from %s and back', (name, male, female) => {
    expect(patronymicFrom(name, 'M')).toBe(male)
    expect(patronymicFrom(name, 'F')).toBe(female)
    expect(fatherNameFromPatronymic(male)).toBe(name)
    expect(fatherNameFromPatronymic(female)).toBe(name)
    expect(patronymicForSex(male, 'F')).toBe(female)
    expect(patronymicForSex(female, 'M')).toBe(male)
  })

  it('handles unknown and non-Russian names conservatively', () => {
    expect(patronymicFrom('John', 'M')).toBe('')
    expect(patronymicFrom('', 'M')).toBe('')
    expect(fatherNameFromPatronymic('Абрамович')).toBe('Абрам')
    expect(fatherNameFromPatronymic('Непонятно')).toBe('')
    expect(patronymicForSex('Зиновьевич', 'F')).toBe('Зиновьевна')
  })

  it.each([
    ['Иванов', 'Иванова'], ['Лебедев', 'Лебедева'], ['Пушкин', 'Пушкина'], ['Тверской', 'Тверская'],
    ['Достоевский', 'Достоевская'], ['Черных', 'Черных'], ['Шевченко', 'Шевченко'], ['Doe', 'Doe'],
  ])('adapts surname %s ↔ %s', (male, female) => {
    expect(surnameForSex(male, 'F')).toBe(female)
    if (male !== 'Тверской') expect(surnameForSex(female, 'M')).toBe(male)
  })

  it.each([
    ['Иван', 'M', 'Ивана'], ['Пётр', 'M', 'Петра'], ['Сергей', 'M', 'Сергея'], ['Игорь', 'M', 'Игоря'], ['Никита', 'M', 'Никиты'], ['Илья', 'M', 'Ильи'],
    ['Анна', 'F', 'Анны'], ['Ольга', 'F', 'Ольги'], ['Мария', 'F', 'Марии'], ['Любовь', 'F', 'Любови'], ['Рахиль', 'F', 'Рахили'], ['John', 'M', 'John'],
  ] as const)('puts %s into the genitive', (name, sex, expected) => {
    expect(genitiveName(name, sex)).toBe(expected)
  })

  it('splits patronymics from given names without touching other double names', () => {
    expect(splitPatronymic('Иван Петрович')).toEqual({ givenName: 'Иван', patronymic: 'Петрович' })
    expect(splitPatronymic('Анна Ильинична')).toEqual({ givenName: 'Анна', patronymic: 'Ильинична' })
    expect(splitPatronymic('Петровна')).toEqual({ givenName: '', patronymic: 'Петровна' })
    expect(splitPatronymic('Mary Ann')).toEqual({ givenName: 'Mary Ann', patronymic: '' })
    expect(splitPatronymic('Анна Мария')).toEqual({ givenName: 'Анна Мария', patronymic: '' })
  })
})

describe('Russian dates', () => {
  it.each([
    ['1900', '1900', '1900'],
    ['1900 г.', '1900', '1900'],
    ['12.03.1900', '12 MAR 1900', '12 марта 1900'],
    ['1900-03-12', '12 MAR 1900', '12 марта 1900'],
    ['12 марта 1900', '12 MAR 1900', '12 марта 1900'],
    ['март 1900', 'MAR 1900', 'март 1900'],
    ['03.1900', 'MAR 1900', 'март 1900'],
    ['ок. 1900', 'ABT 1900', 'ок. 1900'],
    ['около 1900 года', 'ABT 1900', 'ок. 1900'],
    ['~1900', 'ABT 1900', 'ок. 1900'],
    ['до 1917', 'BEF 1917', 'до 1917'],
    ['после 5 мая 1945', 'AFT 5 MAY 1945', 'после 5 мая 1945'],
    ['между 1890 и 1895', 'BET 1890 AND 1895', 'между 1890 и 1895'],
    ['1890–1895', 'BET 1890 AND 1895', 'между 1890 и 1895'],
    ['с 1914 по 1918', 'FROM 1914 TO 1918', 'с 1914 по 1918'],
    ['5 мая 1880 ст. ст.', '@#DJULIAN@ 5 MAY 1880', '5 мая 1880 ст. ст.'],
    ['ABT 1900', 'ABT 1900', 'ок. 1900'],
    ['12 mar 1900', '12 MAR 1900', '12 марта 1900'],
  ])('parses "%s" as %s and displays it as "%s"', (input, gedcom, display) => {
    expect(parseDateInput(input)).toEqual({ value: gedcom, recognized: true })
    expect(formatDate(gedcom, 'ru')).toBe(display)
    expect(parseDateInput(formatDate(gedcom, 'ru')).value).toBe(gedcom)
  })

  it('keeps unrecognized text and rejects impossible calendar dates', () => {
    expect(parseDateInput('весной')).toEqual({ value: 'весной', recognized: false })
    expect(parseDateInput('31.02.1900').recognized).toBe(false)
    expect(parseDateInput('').value).toBe('')
    expect(parseDateInput('5 мая 1880 ст. ст.', '7.0').value).toBe('JULIAN 5 MAY 1880')
    expect(formatDate('JULIAN 5 MAY 1880', 'ru')).toBe('5 мая 1880 ст. ст.')
    expect(formatDate('(весной)', 'ru')).toBe('весной')
  })

  it('extracts years for cards and checks', () => {
    expect(yearOf('ABT 1900')).toBe(1900)
    expect(yearOf('12 MAR 1900')).toBe(1900)
    expect(yearOf('весной')).toBeUndefined()
    expect(shortYear('ABT 1900')).toBe('≈1900')
    expect(shortYear('BEF 1917')).toBe('<1917')
    expect(shortYear('BET 1890 AND 1895')).toBe('≈1890')
    expect(shortYear('весной')).toBe('?')
  })
})

describe('English dates', () => {
  it('parses English input into GEDCOM values', () => {
    const cases: [string, string][] = [
      ['about 1900', 'ABT 1900'], ['abt. 1900', 'ABT 1900'], ['ca. 1900', 'ABT 1900'], ['circa 1900', 'ABT 1900'],
      ['calc. 1900', 'CAL 1900'], ['calculated 1900', 'CAL 1900'], ['est. 1900', 'EST 1900'], ['estimated 1900', 'EST 1900'],
      ['before 1917', 'BEF 1917'], ['bef. 1917', 'BEF 1917'], ['after 1920', 'AFT 1920'],
      ['between 1890 and 1895', 'BET 1890 AND 1895'], ['from 1900 to 1910', 'FROM 1900 TO 1910'],
      ['12 Mar 1880', '12 MAR 1880'], ['12 March 1880', '12 MAR 1880'], ['March 12, 1880', '12 MAR 1880'], ['May 1880', 'MAY 1880'],
      ['12 Mar 1880 (O.S.)', '@#DJULIAN@ 12 MAR 1880'], ['1880 julian', '@#DJULIAN@ 1880'],
    ]
    for (const [input, value] of cases) expect(parseDateInput(input), input).toEqual({ value, recognized: true })
  })

  it('keeps accepting Russian input unchanged', () => {
    expect(parseDateInput('ок. 1900').value).toBe('ABT 1900')
    expect(parseDateInput('расч. 1900').value).toBe('CAL 1900')
    expect(parseDateInput('5 мая 1880 ст. ст.').value).toBe('@#DJULIAN@ 5 MAY 1880')
    expect(parseDateInput('с 1900 по 1910').value).toBe('FROM 1900 TO 1910')
  })

  it('formats GEDCOM values in English', () => {
    expect(formatDate('ABT 1900', 'en')).toBe('abt. 1900')
    expect(formatDate('12 MAR 1900', 'en')).toBe('12 Mar 1900')
    expect(formatDate('MAR 1900', 'en')).toBe('Mar 1900')
    expect(formatDate('BET 1890 AND 1895', 'en')).toBe('between 1890 and 1895')
    expect(formatDate('FROM 1900 TO 1910', 'en')).toBe('from 1900 to 1910')
    expect(formatDate('@#DJULIAN@ 5 MAY 1880', 'en')).toBe('5 May 1880 (O.S.)')
    expect(formatDate('12 MAR 1900', 'ru')).toBe('12 марта 1900')
  })
})
