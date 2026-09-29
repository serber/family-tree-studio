import { AppError } from '../../shared/errors'
import { t } from '../../shared/i18n'
import { createSkeleton } from '../gedcom/skeleton'
import { patronymicFrom, surnameForSex } from './names'
import { emptyFamily, emptyPerson, type Family, type Person, type TreeDocument } from './tree'

const maleNames = ['Александр', 'Михаил', 'Иван', 'Николай', 'Андрей', 'Алексей', 'Пётр', 'Сергей', 'Дмитрий', 'Василий']
const femaleNames = ['Анна', 'Мария', 'Елена', 'Софья', 'Вера', 'Наталья', 'Ольга', 'Татьяна', 'Ирина', 'Екатерина']
const surnames = ['Леснов', 'Волков', 'Соколов', 'Морозов', 'Белов', 'Орлов', 'Лебедев', 'Тихонов', 'Романов', 'Зайцев']
const places = ['Москва', 'Тверь', 'Ярославль', 'Кострома', 'Вологда', 'Рязань', 'Тула', 'Калуга']

/** Deterministic fictional genealogy with repeated marriages, for trying the editor and for scale tests. */
export function createDemo(count = 100): TreeDocument {
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
      patronymic: father ? patronymicFrom(father.givenName, sex) : '',
      surname: surnameForSex(surname, sex),
      sex,
      birthDate: index % 5 === 0 ? `ABT ${year}` : String(year),
      birthPlace: places[index % places.length],
      deathDate: year + 72 < 2026 ? String(year + 65 + index % 12) : '',
      note: index === 0 ? t('editor.defaults.demoNote') : '',
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
      if (spouseSex === 'F') { spouse.birthSurname = spouse.surname; spouse.surname = surnameForSex(current.surname, 'F') }
      const father = current.sex === 'M' ? current : spouse
      const familySurname = surnameForSex(father.surname, 'M')
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
  return { schemaVersion: 2, id: `demo-${count}`, title: t('editor.defaults.demoTitle'), people, families, gedcom: createSkeleton('lesnov-demo.ged'), nextIds: { person: personCount + 1, family: familyCount + 1 } }
}
