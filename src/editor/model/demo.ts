import { AppError } from '../../shared/errors'
import { t, type Locale } from '../../shared/i18n'
import { exportGedcom } from '../gedcom/serializer'
import { createSkeleton } from '../gedcom/skeleton'
import { patronymicFrom, surnameForSex } from './names'
import { emptyFamily, emptyPerson, type Family, type Person, type TreeDocument } from './tree'

/** Names of the demo family per language: a Russian family (with patronymics and gendered surnames) and an English one. */
const cultures: Record<Locale, { maleNames: string[]; femaleNames: string[]; surnames: string[]; places: string[]; patronymics: boolean }> = {
  ru: {
    maleNames: ['Александр', 'Михаил', 'Иван', 'Николай', 'Андрей', 'Алексей', 'Пётр', 'Сергей', 'Дмитрий', 'Василий'],
    femaleNames: ['Анна', 'Мария', 'Елена', 'Софья', 'Вера', 'Наталья', 'Ольга', 'Татьяна', 'Ирина', 'Екатерина'],
    surnames: ['Леснов', 'Волков', 'Соколов', 'Морозов', 'Белов', 'Орлов', 'Лебедев', 'Тихонов', 'Романов', 'Зайцев'],
    places: ['Москва', 'Тверь', 'Ярославль', 'Кострома', 'Вологда', 'Рязань', 'Тула', 'Калуга'],
    patronymics: true,
  },
  en: {
    maleNames: ['William', 'John', 'Thomas', 'James', 'George', 'Henry', 'Charles', 'Edward', 'Robert', 'Arthur'],
    femaleNames: ['Mary', 'Elizabeth', 'Anne', 'Sarah', 'Emily', 'Margaret', 'Alice', 'Jane', 'Catherine', 'Florence'],
    surnames: ['Harper', 'Walker', 'Bennett', 'Carter', 'Hughes', 'Turner', 'Fletcher', 'Mason', 'Parker', 'Ellis'],
    places: ['York', 'Norwich', 'Bath', 'Chester', 'Oxford', 'Exeter', 'Durham', 'Lincoln'],
    patronymics: false,
  },
}

/** Size of the demo family the app ships (examples/demo-family.<locale>.ged). */
export const DEMO_SIZE = 300

/**
 * Deterministic fictional genealogy with repeated marriages: one progenitor couple and all their descendants.
 * People are added breadth-first, so a smaller demo is exactly the first people of a larger one.
 * `locale` picks the family: Russian (the default, used by tests) or English.
 * The app does not call this: it opens examples/demo-family.<locale>.ged, written from `demoGedcom`.
 */
export function createDemo(count = 100, locale: Locale = 'ru'): TreeDocument {
  const { maleNames, femaleNames, surnames, places, patronymics } = cultures[locale]
  const gendered = (surname: string, sex: 'M' | 'F') => patronymics ? surnameForSex(surname, sex) : surname
  if (!Number.isInteger(count) || count < 2 || count > 3000) throw new AppError('demoSize', { min: 2, max: 3000 })
  const people: Record<string, Person> = {}
  const families: Record<string, Family> = {}
  let personCount = 0
  let familyCount = 0
  function addPerson(generation: number, surname: string, sex: 'M' | 'F', father?: Person): string {
    const index = personCount++
    const id = `I${index + 1}`
    const year = 1800 + generation * 27 + index % 7
    people[id] = emptyPerson(id, {
      givenName: (sex === 'M' ? maleNames : femaleNames)[Math.floor(index / 2) % 10],
      patronymic: father && patronymics ? patronymicFrom(father.givenName, sex) : '',
      surname: gendered(surname, sex),
      sex,
      birthDate: index % 5 === 0 ? `ABT ${year}` : String(year),
      birthPlace: places[index % places.length],
      deathDate: year + 72 < 2026 ? String(year + 65 + index % 12) : '',
      note: index === 0 ? t('editor.defaults.demoNote', undefined, locale) : '',
    })
    return id
  }
  const root = addPerson(0, surnames[0], 'M')
  const queue = [{ id: root, generation: 0 }]
  for (let cursor = 0; cursor < queue.length && personCount < count; cursor++) {
    const current = people[queue[cursor].id]
    const generation = queue[cursor].generation
    const marriages = cursor > 0 && cursor % 11 === 0 ? 2 : 1
    for (let marriage = 0; marriage < marriages && personCount < count; marriage++) {
      const spouseSex = current.sex === 'M' ? 'F' : 'M'
      const spouseId = addPerson(generation, surnames[(cursor + marriage + 1) % surnames.length], spouseSex)
      const spouse = people[spouseId]
      if (spouseSex === 'F') { spouse.birthSurname = spouse.surname; spouse.surname = gendered(current.surname, 'F') }
      const father = current.sex === 'M' ? current : spouse
      const familySurname = gendered(father.surname, 'M')
      const family = emptyFamily(`F${++familyCount}`, { partnerIds: [current.id, spouseId], marriageDate: String(1822 + generation * 27) })
      const childCount = marriage === 0 ? 2 + (cursor % 2) : 1
      for (let child = 0; child < childCount && personCount < count; child++) {
        const sex = personCount % 2 === 0 ? 'M' : 'F'
        const id = addPerson(generation + 1, familySurname, sex, father)
        family.childIds.push(id)
        queue.push({ id, generation: generation + 1 })
      }
      families[family.id] = family
    }
  }
  return { schemaVersion: 2, id: `demo-${count}`, title: t('editor.defaults.demoTitle', undefined, locale), people, families, gedcom: createSkeleton(`demo-family.${locale}.ged`), nextIds: { person: personCount + 1, family: familyCount + 1 } }
}

/** The demo as a GEDCOM file, in the family of the given language. */
export function demoGedcom(locale: Locale, count = DEMO_SIZE): string {
  return exportGedcom(createDemo(count, locale))
}
