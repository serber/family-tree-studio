import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Карточка человека' })
const field = (page: Page, name: string) => panel(page).locator(`[name="${name}"]`)

async function startNewTree(page: Page) {
  await page.goto('/ru/editor/')
  await page.getByRole('button', { name: /Начать новое дерево/ }).click()
  await expect(field(page, 'givenName')).toBeFocused()
}

test('enters a family from scratch with suggestions, keyboard shortcuts, undo/redo, and reload', async ({ page }) => {
  const errors = trackErrors(page)
  await startNewTree(page)
  await page.keyboard.type('Иван')
  await field(page, 'patronymic').fill('Петрович')
  await field(page, 'surname').fill('Сидоров')
  await panel(page).getByRole('button', { name: 'Мужской' }).click()
  await field(page, 'birthDate').fill('ок. 1920')
  await expect(panel(page).getByText('→ ок. 1920')).toBeVisible()
  await field(page, 'birthPlace').fill('Тверь')
  await field(page, 'birthPlace').press('Enter')

  // Add father from the card: name and surname are suggested from the patronymic.
  await page.locator('.react-flow__node-person').first().getByRole('button', { name: /Отец/ }).click()
  await expect(field(page, 'givenName')).toHaveValue('Пётр')
  await expect(field(page, 'surname')).toHaveValue('Сидоров')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Сидоров Иван Петрович')

  // Wife and daughter via keyboard (physical keys of П and Д in the Russian layout).
  await page.keyboard.press('KeyG')
  await expect(field(page, 'surname')).toHaveValue('Сидорова')
  await page.keyboard.type('Анна')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+ArrowLeft')
  await page.keyboard.press('KeyL')
  await expect(field(page, 'patronymic')).toHaveValue('')
  await expect(field(page, 'surname')).toHaveValue('Сидорова')
  await page.keyboard.type('Ольга')
  await page.keyboard.press('Escape')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Сидорова Ольга')
  // The patronymic is not prefilled; the father-based suggestion fills it only on click.
  await panel(page).locator('button.suggestion', { hasText: 'Ивановна?' }).click()
  await expect(field(page, 'patronymic')).toHaveValue('Ивановна')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Сидорова Ольга Ивановна')
  await expect(panel(page).getByText('дочь Ивана и Анны')).toBeVisible()
  await expect(page.locator('.react-flow__node-person')).toHaveCount(4)

  // Undo removes the patronymic, the typed name, and then the daughter as separate steps; redo restores all.
  await page.keyboard.press('Control+z')
  await expect(field(page, 'patronymic')).toHaveValue('')
  await page.keyboard.press('Control+z')
  await expect(field(page, 'givenName')).toHaveValue('')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node-person')).toHaveCount(3)
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.react-flow__node-person')).toHaveCount(4)

  await expect(page.getByTestId('save-status')).toContainText('Сохранено')
  await page.reload()
  await expect(page.locator('.react-flow__node-person')).toHaveCount(4)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('ольга')
  await page.keyboard.press('Enter')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Сидорова Ольга Ивановна')
  await expect(field(page, 'givenName')).not.toBeFocused()
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/editor-family.png' })
})

test('clicking a card without a given name puts the cursor in the name field', async ({ page }) => {
  const errors = trackErrors(page)
  await startNewTree(page)
  await page.keyboard.type('Иван')
  await page.keyboard.press('Escape')
  await page.keyboard.press('KeyG')
  await expect(page.locator('.react-flow__node-person')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(field(page, 'givenName')).not.toBeFocused()
  const named = page.locator('.react-flow__node-person', { hasText: 'Иван' })
  const unnamed = page.locator('.react-flow__node-person').filter({ hasNotText: 'Иван' })
  await named.click()
  await expect(field(page, 'givenName')).toHaveValue('Иван')
  await expect(field(page, 'givenName')).not.toBeFocused()
  await unnamed.click()
  await expect(field(page, 'givenName')).toHaveValue('')
  await expect(field(page, 'givenName')).toBeFocused()
  await page.keyboard.type('Анна')
  await expect(unnamed).toContainText('Анна')
  expect(errors).toEqual([])
})

test('links an existing person as a parent, refuses cycles, and undoes a deletion from the toast', async ({ page }) => {
  const errors = trackErrors(page)
  await startNewTree(page)
  await page.keyboard.type('Дочь')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Найти человека' }).click()
  await page.getByRole('option', { name: /Добавить человека без связей/ }).click()
  await page.keyboard.type('Отец')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Дочь')
  await page.keyboard.press('Enter')
  await panel(page).getByRole('button', { name: 'Выбрать из дерева' }).first().click()
  await page.getByRole('dialog', { name: /Выберите родителя/ }).getByRole('combobox').fill('Отец')
  await page.keyboard.press('Enter')
  await expect(panel(page).locator('.relative-row').filter({ hasText: 'Отец' })).toBeVisible()

  // The daughter cannot be chosen as her father's parent.
  await panel(page).locator('.relative-row').filter({ hasText: 'Отец' }).getByRole('button', { name: /Отец/ }).click()
  await panel(page).getByRole('button', { name: 'Выбрать из дерева' }).first().click()
  await page.getByRole('combobox', { name: 'Поиск' }).fill('Дочь')
  await expect(page.getByText('Никого не нашли')).toBeVisible()
  await page.keyboard.press('Escape')

  await panel(page).getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'удалён' })).toBeVisible()
  await expect(page.locator('.react-flow__node-person')).toHaveCount(1)
  await page.locator('.toast').getByRole('button', { name: 'Отменить' }).click()
  await expect(page.locator('.react-flow__node-person')).toHaveCount(2)
  expect(errors).toEqual([])
})

test('loads 3,000 people, finds and edits the last person without relayout, and records timings', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await page.goto('/ru/editor/')
  await page.getByRole('button', { name: /Посмотреть на примере/ }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')
  // The same demo family grown to 3,000 people (scripts/generate-demo.ts), opened as a GEDCOM file.
  const started = Date.now()
  await page.getByTestId('gedcom-input').setInputFiles(fileURLToPath(new URL('./fixtures/demo-3000.ged', import.meta.url)))
  await expect(page.locator('.canvas-stats')).toContainText('3 000 чел.', { timeout: 60_000 })
  await expect(page.locator('.canvas-stats')).toContainText('раскладка')
  const readyMs = Date.now() - started
  const stats = await page.locator('.canvas-stats').textContent()

  const searchStart = Date.now()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('I3000')
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node-person[data-id="I3000"]')).toBeInViewport()
  const searchMs = Date.now() - searchStart

  // Keystroke-to-paint latency in the name field (includes React render of the card and inspector).
  const keystrokes = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[name="givenName"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const samples: number[] = []
    for (const text of ['Т', 'Те', 'Тес', 'Тест', 'Тесто', 'Тестов', 'Тестовы', 'Тестовый']) {
      const start = performance.now()
      setter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      samples.push(performance.now() - start)
    }
    return samples
  })
  await expect(page.locator('.react-flow__node-person[data-id="I3000"]')).toContainText('Тестовый')
  await expect(page.locator('.canvas-stats')).toHaveText(stats!)

  const selectStart = Date.now()
  await page.locator('.react-flow__node-person').filter({ hasNotText: 'Тестовый' }).first().click()
  await expect(panel(page).getByRole('heading', { level: 2 })).not.toContainText('Тестовый')
  const selectMs = Date.now() - selectStart

  await page.keyboard.press('Digit0')
  await expect(page.locator('.canvas-controls .zoom-value')).not.toHaveText('90%')
  const metrics = {
    browser: await page.evaluate(() => navigator.userAgent), readyMs, stats, searchMs, selectMs,
    keystrokeMs: { median: [...keystrokes].sort((a, b) => a - b)[4], max: Math.max(...keystrokes), samples: keystrokes.map((value) => Math.round(value)) },
  }
  await testInfo.attach('large-tree-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
  console.log(JSON.stringify(metrics))
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/tree-3000.png' })
})

test('asks before replacing unsaved work, restores a downloaded backup and an automatic version', async ({ page }) => {
  await startNewTree(page)
  await page.keyboard.type('Резервный')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('save-status')).toContainText('Сохранено в браузере')

  // Unsaved work: replacing it asks first, and cancelling keeps it.
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Демо: 300 человек' }).click()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('.canvas-stats')).toContainText('1 чел.')

  await page.getByRole('button', { name: 'Файл' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Скачать резервную копию' }).click()
  const path = await (await downloaded).path()
  await expect(page.getByTestId('save-status')).toContainText('выгружено')

  // After a download there is nothing to lose, so no confirmation is needed.
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Демо: 300 человек' }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')

  await page.getByTestId('backup-input').setInputFiles(path!)
  await expect(page.locator('.canvas-stats')).toContainText('1 чел.')
  await expect(page.locator('.react-flow__node-person')).toContainText('Резервный')
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Автосохранённые версии…' }).click()
  await page.getByRole('dialog', { name: 'Автосохранённые версии' }).getByRole('button', { name: /300 чел\./ }).first().click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')
})

test('flags a person entered twice and merges the duplicates from the checks view', async ({ page }) => {
  const errors = trackErrors(page)
  await startNewTree(page)
  await page.keyboard.type('Пётр')
  await field(page, 'surname').fill('Орлов')
  await field(page, 'surname').press('Enter')
  await page.keyboard.press('KeyC')
  await page.keyboard.type('Сын')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: /Добавить человека без связей/ }).click()
  await page.keyboard.type('Пётр')
  await field(page, 'surname').fill('Орлов')
  await field(page, 'deathPlace').fill('Тверь')
  await field(page, 'deathPlace').press('Enter')
  await page.getByRole('button', { name: /Замечания/ }).click()
  await expect(page.getByText('Возможный дубликат')).toBeVisible()
  await page.getByRole('button', { name: 'Объединить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Объединить' }).click()
  await expect(page.getByText('Возможный дубликат')).toHaveCount(0)
  await page.getByRole('button', { name: /Дерево/ }).click()
  await expect(page.locator('.react-flow__node-person')).toHaveCount(2)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Орлов Пётр')
  await page.keyboard.press('Enter')
  await expect(field(page, 'deathPlace')).toHaveValue('Тверь')
  await expect(panel(page).locator('.relative-row').filter({ hasText: 'Сын' })).toBeVisible()
  expect(errors).toEqual([])
})

test('review mode marks people without moving the selection, persists, and never changes the GEDCOM', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/ru/editor/')
  await page.getByRole('button', { name: /Посмотреть на примере/ }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')
  const exportText = async () => {
    const download = page.waitForEvent('download')
    await page.keyboard.press('Control+s')
    const { readFileSync } = await import('node:fs')
    return readFileSync((await (await download).path())!, 'utf8')
  }
  const before = await exportText()

  await page.getByRole('button', { name: /Режим проверки/ }).click()
  await expect(page.getByTestId('review-progress')).toHaveText('0 из 300')
  await expect(page.locator('.person-card.is-unverified').first()).toBeVisible()
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Леснов Александр')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('review-progress')).toHaveText('1 из 300')
  await expect(page.locator('.react-flow__node-person[data-id="I1"] .person-card')).toHaveClass(/is-verified/)
  await expect(panel(page).locator('.verify-bar.ok')).toContainText('Проверен')

  // Marking never moves the selection; moving to the next unchecked person is a separate, explicit action.
  await panel(page).getByRole('button', { name: /Следующий/ }).click()
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Леснова Анна')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('review-progress')).toHaveText('2 из 300')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Леснова Анна')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('review-progress')).toHaveText('1 из 300')
  await panel(page).getByRole('button', { name: 'Проверено' }).click()
  await expect(page.getByTestId('review-progress')).toHaveText('2 из 300')
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Леснова Анна')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('review-progress')).toHaveText('1 из 300')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByTestId('review-progress')).toHaveText('2 из 300')

  await expect(page.getByTestId('save-status')).toContainText('Сохранено')
  await page.reload()
  await expect(page.getByTestId('review-progress')).toHaveText('2 из 300')
  await page.getByRole('button', { name: /Таблица/ }).click()
  await page.getByLabel('Статус проверки').selectOption('todo')
  await expect(page.locator('.view-toolbar .count')).toHaveText('298 из 300')
  await page.getByRole('button', { name: /Дерево/ }).click()
  expect(await exportText()).toBe(before)
  expect(errors).toEqual([])
})

/** The number of autosaved versions offered on the welcome screen. */
async function versionCount(page: Page) {
  const text = await page.getByRole('button', { name: /Автосохранённые версии \(\d+\)/ }).textContent()
  return Number(text!.match(/\((\d+)\)/)![1])
}

test('closes the tree to the welcome screen, reopens it from an autosaved version, and deletes versions', async ({ page }) => {
  const errors = trackErrors(page)
  await startNewTree(page)
  await page.keyboard.type('Закрытый')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('save-status')).toContainText('Сохранено в браузере')

  // Undownloaded work: closing asks first, and cancelling keeps the tree open.
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Закрыть дерево' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Закрыть дерево?' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('.react-flow__node-person')).toContainText('Закрытый')

  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Закрыть дерево' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('button', { name: /Начать новое дерево/ })).toBeVisible()

  // The draft is gone: a reload stays on the welcome screen.
  await page.reload()
  await expect(page.getByRole('button', { name: /Начать новое дерево/ })).toBeVisible()

  // The closed tree is the newest autosaved version and opens from the welcome screen.
  await page.getByRole('button', { name: /Автосохранённые версии \(\d+\)/ }).click()
  await page.getByRole('dialog', { name: 'Автосохранённые версии' }).getByRole('button', { name: /1 чел\./ }).first().click()
  await expect(page.locator('.react-flow__node-person')).toContainText('Закрытый')

  // A downloaded tree closes without a question, and its copy is added to the versions.
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Демо: 300 человек' }).click()
  await page.getByRole('button', { name: 'Заменить' }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')
  await expect(page.getByTestId('save-status')).toContainText('выгружено')
  await page.getByRole('button', { name: 'Файл' }).click()
  await page.getByRole('menuitem', { name: 'Закрыть дерево' }).click()
  await expect(page.getByRole('button', { name: /Начать новое дерево/ })).toBeVisible()
  const versions = await versionCount(page)

  // Delete one version (with an inline confirmation), then all of them.
  await page.getByRole('button', { name: /Автосохранённые версии \(\d+\)/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Автосохранённые версии' })
  await expect(dialog.getByRole('button', { name: /300 чел\./ }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Удалить эту версию' })).toHaveCount(versions)
  await dialog.getByRole('button', { name: 'Удалить эту версию' }).first().click()
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  await expect(dialog.getByRole('button', { name: 'Удалить эту версию' })).toHaveCount(versions)
  await dialog.getByRole('button', { name: 'Удалить эту версию' }).first().click()
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Удалить эту версию' })).toHaveCount(versions - 1)
  await dialog.getByRole('button', { name: 'Удалить все' }).click()
  await expect(dialog.getByText(/^Удалить (все \d+ верси[яий]+|единственную версию)\? Это нельзя отменить\.$/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Удалить все' }).click()
  await expect(dialog.getByText('Версий пока нет.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByRole('button', { name: /Автосохранённые версии/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the table and issues views are not covered by the hidden tree canvas', async ({ page }) => {
  await page.goto('/ru/editor/')
  await page.getByRole('button', { name: /Посмотреть на примере/ }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 чел.')
  await expect(page.locator('.react-flow__node-person').first()).toBeVisible()
  // React Flow sets inline visibility: visible and pointer-events: all on cards, so hit testing is the real check.
  const canvasHits = () => page.evaluate(() => {
    const main = document.querySelector('.main-view')!.getBoundingClientRect()
    let hits = 0
    for (let x = main.left + 10; x < main.right; x += 40) for (let y = main.top + 10; y < main.bottom; y += 40) {
      if (document.elementFromPoint(x, y)?.closest('.canvas')) hits++
    }
    return hits
  })
  for (const view of ['Таблица', 'Замечания']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await expect.poll(canvasHits).toBe(0)
  }
  await page.getByRole('button', { name: 'Дерево', exact: true }).click()
  await expect.poll(canvasHits).toBeGreaterThan(0)
  await expect(page.locator('.react-flow__node-person').first()).toBeVisible()
})
