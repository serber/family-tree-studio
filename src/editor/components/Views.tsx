import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, Combine, Crosshair, TriangleAlert } from 'lucide-react'
import { yearOf } from '../model/dates'
import type { GedcomWarning } from '../gedcom/types'
import { type Issue, type IssueKind } from '../model/issues'
import { t } from '../i18n'
import { fullName, initials, lifespan, parentageLabel, relativesOf, searchPeople, type Person, type TreeDocument, type TreeIndex } from '../model/tree'

const ROW_HEIGHT = 44

type SortKey = 'name' | 'birth' | 'place'

/** Virtualized list of everyone, for checking what has been entered. */
export function PeopleTable({ tree, index, selectedId, onSelect, onOpen, review }: { tree: TreeDocument; index: TreeIndex; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; review: Record<string, string> | null }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'todo' | 'ok'>('all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(800)
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const found = query.trim() ? searchPeople(tree.people, query) : Object.values(tree.people)
    const people = review && status !== 'all' ? found.filter((person) => !!review[person.id] === (status === 'ok')) : found
    const compare = {
      name: (a: Person, b: Person) => fullName(a).localeCompare(fullName(b), 'ru'),
      birth: (a: Person, b: Person) => (yearOf(a.birthDate) ?? 99999) - (yearOf(b.birthDate) ?? 99999) || fullName(a).localeCompare(fullName(b), 'ru'),
      place: (a: Person, b: Person) => (a.birthPlace || '￿').localeCompare(b.birthPlace || '￿', 'ru'),
    }[sort.key]
    const sorted = [...people].sort(compare)
    return sort.desc ? sorted.reverse() : sorted
  }, [tree.people, query, sort, review, status])

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10)
  const visible = rows.slice(first, first + Math.ceil(height / ROW_HEIGHT) + 20)
  const header = (key: SortKey, label: string) => <button onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }))}>
    {label}{sort.key === key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
  </button>

  return <div className="table-view">
    <div className="view-toolbar">
      <input className="input" placeholder={t('table.filterPlaceholder')} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('table.filter')} />
      {review && <select className="input" style={{ width: 'auto' }} value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label={t('table.status')}>
        <option value="all">{t('table.statusAll')}</option><option value="todo">{t('table.statusTodo')}</option><option value="ok">{t('table.statusOk')}</option>
      </select>}
      <span className="count">{t('table.count', { shown: rows.length, total: Object.keys(tree.people).length })}</span>
    </div>
    <div className="table-scroll" ref={(element) => { scrollRef.current = element; if (element && element.clientHeight !== height) setHeight(element.clientHeight) }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="people-table" role="table" aria-label={t('table.label')}>
        <div className="table-head" role="row">{header('name', t('table.name'))}{header('birth', t('table.years'))}{header('place', t('table.birthPlace'))}<span>{t('table.parents')}</span><span>{t('table.children')}</span></div>
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((person, offset) => {
            const relatives = relativesOf(tree, person.id, index)
            return <div key={person.id} role="row" className={`table-row ${person.id === selectedId ? 'active' : ''}`} style={{ position: 'absolute', top: (first + offset) * ROW_HEIGHT, left: 0, right: 0 }}
              onClick={() => onSelect(person.id)} onDoubleClick={() => onOpen(person.id)}>
              <span className="name-cell">{review && <span className={`status-dot ${review[person.id] ? 'ok' : 'todo'}`} title={t(review[person.id] ? 'review.verified' : 'review.unverified')} />}<span className={`avatar sm sex-${person.sex}`}>{initials(person)}</span><span>{fullName(person)}</span></span>
              <span className="dim">{lifespan(person) || '—'}</span>
              <span className="dim">{person.birthPlace || '—'}</span>
              <span className="dim">{relatives.parents.map((id) => tree.people[id].givenName || fullName(tree.people[id])).join(', ') || '—'}</span>
              <span className="dim">{relatives.children.length || '—'}</span>
            </div>
          })}
        </div>
      </div>
    </div>
  </div>
}

/** An issue in words: names are read from the tree at render time, so they follow edits and the language. */
function issueMessage(tree: TreeDocument, issue: Issue): string {
  const name = fullName(tree.people[issue.personId])
  const related = issue.relatedId && tree.people[issue.relatedId] ? fullName(tree.people[issue.relatedId]) : ''
  return t(`issues.messages.${issue.kind}`, { name, related, ...issue.values })
}

function warningMessage(warning: GedcomWarning): string {
  return typeof warning === 'string' ? warning : t(`gedcomWarnings.${warning.code}`, warning.values)
}

const issueOrder: IssueKind[] = ['duplicate', 'deathBeforeBirth', 'parentTooYoung', 'parentTooOld', 'bornAfterParentDeath', 'badDate', 'isolated', 'noName', 'noSex']

export function IssuesView({ tree, index, issues, selectedId, onSelect, onShow, onMerge }: { tree: TreeDocument; index: TreeIndex; issues: Issue[]; selectedId: string | null; onSelect: (id: string) => void; onShow: (id: string) => void; onMerge: (keepId: string, removeId: string) => void }) {
  const groups = issueOrder.map((kind) => ({ kind, items: issues.filter((issue) => issue.kind === kind) })).filter((group) => group.items.length)
  const warnings = tree.gedcom.warnings
  return <div className="issues-view">
    <div className="view-toolbar"><strong style={{ fontSize: 14 }}>{t('issues.title')}</strong><span className="count">{t('issues.intro')}</span></div>
    <div className="issues-scroll">
      {!groups.length && !warnings.length && <div className="issues-empty"><CheckCircle2 size={36} color="var(--accent)" /><strong>{t('issues.none')}</strong><span>{t('issues.noneHint')}</span></div>}
      {groups.map((group) => <div className="issue-group" key={group.kind}>
        <h3><TriangleAlert size={15} color="var(--warning)" />{t(`issues.kinds.${group.kind}`)}<span className="badge">{group.items.length}</span></h3>
        {group.items.slice(0, 300).map((issue, position) => <div key={position} style={{ display: 'flex', alignItems: 'center' }}>
          <button className={`issue-item ${issue.personId === selectedId ? 'active' : ''}`} onClick={() => onSelect(issue.personId)}>
            <span className={`avatar sm sex-${tree.people[issue.personId].sex}`}>{initials(tree.people[issue.personId])}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{issueMessage(tree, issue)}<br /><small style={{ color: 'var(--text-3)' }}>{parentageLabel(tree, issue.personId, index)}</small></span>
          </button>
          {issue.kind === 'duplicate' && issue.relatedId && tree.people[issue.relatedId] && <button className="btn btn-ghost btn-sm" onClick={() => onMerge(issue.personId, issue.relatedId!)}><Combine size={14} />{t('issues.merge')}</button>}
          <button className="icon-btn sm" title={t('inspector.center')} aria-label={t('inspector.center')} onClick={() => onShow(issue.personId)}><Crosshair size={14} /></button>
        </div>)}
        {group.items.length > 300 && <p className="muted">{t('issues.more', { count: group.items.length - 300 })}</p>}
      </div>)}
      {warnings.length > 0 && <div className="issue-group">
        <h3><TriangleAlert size={15} color="var(--warning)" />{t('issues.gedcomTitle')}<span className="badge">{warnings.length}{warnings.length === 100 ? '+' : ''}</span></h3>
        {warnings.map((warning, position) => <div key={position} className="issue-item">{warningMessage(warning)}</div>)}
      </div>}
    </div>
  </div>
}
