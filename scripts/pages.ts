import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type Plugin } from 'vite'

/**
 * Localized pages for a multi-page build.
 *
 * Every page has one HTML template (index.html, editor/index.html, viewer/index.html)
 * with three placeholders: <!--page-head-->, <!--page-body--> and <!--page-noscript-->.
 * This plugin fills them per locale from messages/<locale>.json (`meta.<page>`):
 *
 * - dev: per request — /ru/… is served from the same template with Russian metadata;
 * - build: writes dist/<page>/index.html (English) and dist/ru/<page>/index.html (Russian),
 *   pre-renders the landing page into both (React hydrates it), and generates
 *   sitemap.xml and robots.txt.
 *
 * Asset URLs are absolute (base '/'), so the English copies one level deeper need no rewriting.
 */

export const SITE_ORIGIN = 'https://treestudio.app'

type Locale = 'ru' | 'en'
const LOCALES: Locale[] = ['ru', 'en']
const DEFAULT_LOCALE: Locale = 'en'
const PREFIXED_LOCALE: Locale = 'ru'
const PREFIX = new RegExp(`^/${PREFIXED_LOCALE}(/|$)`)

interface PageConfig {
  /** Locale-free URL path. */
  path: string
  /** Template, relative to the project root. */
  template: string
  /** Whether the body is pre-rendered at build time (content pages only). */
  prerender?: string
  /** schema.org type for the JSON-LD block. */
  schema: 'WebSite' | 'WebApplication'
}

export const PAGES: Record<'home' | 'editor' | 'viewer', PageConfig> = {
  home: { path: '/', template: 'index.html', prerender: '/src/landing/render.tsx', schema: 'WebSite' },
  editor: { path: '/editor/', template: 'editor/index.html', schema: 'WebApplication' },
  viewer: { path: '/viewer/', template: 'viewer/index.html', schema: 'WebApplication' },
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogs = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(readFileSync(resolve(root, `messages/${locale}.json`), 'utf8'))])) as Record<Locale, unknown>

function message(locale: Locale, key: string): string {
  let node: unknown = catalogs[locale]
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  if (typeof node !== 'string') throw new Error(`pages: missing message "${key}" in messages/${locale}.json`)
  return node
}

const localizedPath = (path: string, locale: Locale) => locale === DEFAULT_LOCALE ? path : `/${locale}${path}`
const absolute = (path: string) => SITE_ORIGIN + path
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function pageHead(page: PageConfig, id: string, locale: Locale): string {
  const title = message(locale, `meta.${id}.title`)
  const description = message(locale, `meta.${id}.description`)
  const url = absolute(localizedPath(page.path, locale))
  const image = absolute('/og-image.jpg')
  const other = LOCALES.find((code) => code !== locale)!
  const ogLocale = (code: Locale) => code === 'ru' ? 'ru_RU' : 'en_US'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': page.schema,
    name: page.schema === 'WebSite' ? message(locale, 'common.product') : title,
    url,
    description,
    inLanguage: locale,
    ...(page.schema === 'WebApplication' ? {
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    } : {}),
  }
  const meta = (attr: 'name' | 'property', key: string, content: string) => `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`
  return [
    `<title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    `<link rel="canonical" href="${url}" />`,
    ...LOCALES.map((code) => `<link rel="alternate" hreflang="${code}" href="${absolute(localizedPath(page.path, code))}" />`),
    `<link rel="alternate" hreflang="x-default" href="${absolute(localizedPath(page.path, DEFAULT_LOCALE))}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', message(locale, 'common.product')),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '1200'),
    meta('property', 'og:locale', ogLocale(locale)),
    meta('property', 'og:locale:alternate', ogLocale(other)),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join('\n    ')
}

function renderPage(html: string, page: PageConfig, id: string, locale: Locale, body = ''): string {
  const replace = (source: string, marker: string, value: string) => {
    if (!source.includes(marker)) throw new Error(`pages: ${page.template} has no ${marker}`)
    return source.replace(marker, () => value)
  }
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${locale}"`)
  html = replace(html, '<!--page-head-->', pageHead(page, id, locale))
  html = replace(html, '<!--page-body-->', body)
  html = replace(html, '<!--page-noscript-->', `<noscript><p>${escapeHtml(message(locale, `meta.${id}.noscript`))}</p></noscript>`)
  return html
}

function sitemap(): string {
  const urls = Object.values(PAGES).flatMap((page) => LOCALES.map((locale) => [
    '  <url>',
    `    <loc>${absolute(localizedPath(page.path, locale))}</loc>`,
    ...LOCALES.map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${absolute(localizedPath(page.path, code))}" />`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(localizedPath(page.path, DEFAULT_LOCALE))}" />`,
    '  </url>',
  ].join('\n')))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
}

/** Page id and locale of a dev request URL, or null for anything that is not a page. */
function pageOfUrl(url: string): { id: keyof typeof PAGES; locale: Locale } | null {
  const pathname = url.split(/[?#]/)[0]
  const locale: Locale = PREFIX.test(pathname) ? PREFIXED_LOCALE : DEFAULT_LOCALE
  const path = locale === DEFAULT_LOCALE ? pathname : pathname.slice(PREFIXED_LOCALE.length + 1) || '/'
  const normalized = path.replace(/index\.html$/, '')
  for (const [id, page] of Object.entries(PAGES)) if (page.path === normalized) return { id: id as keyof typeof PAGES, locale }
  return null
}

export function pagesPlugin(): Plugin[] {
  return [pagesDevPlugin(), pagesBuildPlugin()]
}

function pagesDevPlugin(): Plugin {
  return {
    name: 'family-tree-studio:pages-dev',
    apply: 'serve',
    configureServer(server) {
      // Dev: /ru/<page>/ is served from the page's own template; missing trailing slashes redirect.
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split(/[?#]/)[0] ?? ''
        const withSlash = `${pathname}/`
        if (!pathname.endsWith('/') && pageOfUrl(withSlash)) {
          res.statusCode = 301
          res.setHeader('Location', withSlash + (req.url!.slice(pathname.length)))
          res.end()
          return
        }
        if (req.url && PREFIX.test(pathname) && pageOfUrl(pathname)) req.url = req.url.slice(PREFIXED_LOCALE.length + 1) || '/'
        next()
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const found = pageOfUrl(ctx.originalUrl ?? ctx.path) ?? pageOfUrl(ctx.path)
        if (!found) return html
        return renderPage(html, PAGES[found.id], found.id, found.locale)
      },
    },
  }
}

/** Build only: the templates keep their placeholders through the bundle and are filled per locale at the end. */
function pagesBuildPlugin(): Plugin {
  let outDir = ''
  // Worker bundles run this plugin's hooks too; only the bundle that wrote the pages continues.
  let wrotePages = false
  return {
    name: 'family-tree-studio:pages-build',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      wrotePages = Object.values(PAGES).every((page) => page.template in bundle)
    },
    async closeBundle(error?: Error) {
      if (error || !wrotePages) return
      // Pre-render content pages with a throwaway SSR server over the same sources.
      const ssr = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
      try {
        for (const [id, page] of Object.entries(PAGES)) {
          const template = readFileSync(resolve(outDir, page.template), 'utf8')
          const render = page.prerender ? (await ssr.ssrLoadModule(page.prerender)).render as (locale: Locale) => string : undefined
          for (const locale of LOCALES) {
            const file = resolve(outDir, locale === DEFAULT_LOCALE ? '' : locale, page.template)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, renderPage(template, page, id, locale, render?.(locale)))
          }
        }
      } finally {
        await ssr.close()
      }
      writeFileSync(resolve(outDir, 'sitemap.xml'), sitemap())
      writeFileSync(resolve(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)
    },
  }
}
