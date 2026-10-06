import { expect, test, type Page } from '@playwright/test'

/** Collects uncaught errors and console errors of a page. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

test('home page leads to both tools in both languages', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/ru/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Соберите историю своей семьи')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')

  await page.getByRole('link', { name: 'EN' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Put your family's story together")
  await expect(page).toHaveTitle('Online Family Tree Maker: Build It and Print It Large')

  await page.getByRole('link', { name: /Visualizer/ }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/viewer/')
  await expect(page.getByRole('button', { name: 'Download JPEG' })).toBeVisible()

  await page.getByTitle('Home').click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')
  await page.getByRole('link', { name: /Editor/ }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/editor/')
  await expect(page.getByRole('button', { name: /Start a new tree/ })).toBeVisible()

  // Each language has its own demo family: English names here, the Russian family under /ru/.
  await page.getByRole('button', { name: /Try an example/ }).click()
  await expect(page.locator('.canvas-stats')).toContainText('300 people')
  await expect(page.getByLabel('Tree name')).toHaveValue('The Harper family (demo)')
  await expect(page.getByRole('complementary', { name: 'Person card' }).getByRole('heading', { level: 2 })).toHaveText('Harper William')
  expect(errors).toEqual([])
})

test('visualizer draws the sample, re-roots, searches, switches language in place and exports a JPEG', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/ru/viewer/')
  const status = page.locator('.viewer-status')
  await expect(status).toContainText('Показано: 300 человек')
  // StrictMode mounts, unmounts and mounts again in development: exactly one chart must remain.
  await expect(page.locator('.viewer-chart svg')).toHaveCount(1)
  const cells = await page.locator('g.cell').count()
  expect(cells).toBeGreaterThan(250)

  await page.getByPlaceholder('Имя — Enter, чтобы показать').fill('Леснов')
  await expect(status).toContainText('найдено:')

  // Clicking a person re-roots the chart on their branch; «Back» returns.
  const back = page.getByRole('button', { name: '← Назад' })
  await expect(back).toBeHidden()
  await page.locator('g.cell').nth(40).click()
  await expect(back).toBeVisible()
  await back.click()
  await expect(back).toBeHidden()

  // A settings change re-lays the chart out.
  await page.locator('.settings-group').first().locator('select').first().selectOption('cards')
  await expect(page.locator('g.links path').first()).toBeAttached()

  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/viewer/')
  await expect(status).toContainText('Shown: 300 people')
  await expect(page).toHaveTitle('Large Printable Family Tree Chart from GEDCOM — Family Tree Studio')
  await expect(page.getByRole('button', { name: 'Download JPEG' })).toBeVisible()
  await expect(page.locator('.settings-group summary').first()).toHaveText('Layout')
  await expect(page.locator('.settings-group').first().locator('select').first()).toHaveValue('cards')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  // Export: capture the JPEG blob instead of downloading it.
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob && object.type === 'image/jpeg') (window as unknown as { jpegSize: number }).jpegSize = object.size
      return original(object)
    }
  })
  await page.locator('#printSize').selectOption('fullhd')
  await page.getByRole('button', { name: 'Download JPEG' }).click()
  await expect(status).toContainText('Saved: Full HD')
  expect(await page.evaluate(() => (window as unknown as { jpegSize: number }).jpegSize)).toBeGreaterThan(50_000)
  expect(errors).toEqual([])
})

test('editor works in English and keeps its state when the language changes', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/editor/')
  await page.getByRole('button', { name: /Start a new tree/ }).click()
  const panel = page.getByRole('complementary', { name: 'Person card' })
  await panel.locator('input[name="surname"]').fill('Smith')
  await panel.locator('input[name="givenName"]').fill('John')
  await panel.locator('input[name="birthDate"]').fill('abt. 1920')
  await expect(panel.getByText('→ abt. 1920')).toBeVisible()
  await panel.locator('input[name="birthDate"]').press('Enter')
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Smith John')

  await expect(page).toHaveTitle('Online Family Tree Editor — Family Tree Studio')
  await page.getByRole('button', { name: 'RU' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/ru/editor/')
  await expect(page).toHaveTitle('Редактор родословной онлайн — Family Tree Studio')
  const russian = page.getByRole('complementary', { name: 'Карточка человека' })
  await expect(russian.getByRole('heading', { level: 2 })).toHaveText('Smith John')
  await expect(russian.locator('input[name="birthDate"]')).toHaveValue('ок. 1920')
  await expect(page.getByRole('button', { name: 'Файл' })).toBeVisible()

  // Undo history survives the switch.
  await page.getByRole('button', { name: 'EN' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('complementary', { name: 'Person card' }).locator('input[name="birthDate"]')).toHaveValue('')
  expect(errors).toEqual([])
})

test('visualizer shows given names only and hides years of life', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/ru/viewer/')
  await expect(page.locator('.viewer-status')).toContainText('Показано: 300 человек')
  // Only drawn text counts: hover titles keep the full name and years on purpose.
  const chartText = () => page.locator('.viewer-chart svg').evaluate((svg) => [...svg.querySelectorAll('text, textPath')].map((node) => node.textContent ?? '').join('\n'))
  const toggle = (label: string) => page.locator('label.control-toggle', { hasText: label })

  expect(await chartText()).toContain('Леснов')
  expect(await chartText()).toMatch(/\d{4}/)
  await toggle('Показывать только имя').click()
  await expect.poll(chartText).not.toContain('Леснов')
  expect(await chartText()).toContain('Михаил Александрович')
  await toggle('Годы жизни').click()
  await expect.poll(chartText).not.toMatch(/\d{4}/)
  await toggle('Показывать только имя').click()
  await expect.poll(chartText).toContain('Леснов')
  expect(await chartText()).not.toMatch(/\d{4}/)
  expect(errors).toEqual([])
})
