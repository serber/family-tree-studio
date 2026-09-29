import { useEffect, useMemo, useRef } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Combine, Crosshair, Link2, Plus, Trash2, Undo2, X } from 'lucide-react'
import { Field, DateInput, Segmented, TextInput } from './fields'
import { fatherNameFromPatronymic, patronymicFrom } from '../model/names'
import { fullName, initials, lifespan, parentageLabel, relativesOf, type Family, type Person, type PersonFields, type Sex, type TreeDocument, type TreeIndex } from '../model/tree'
import type { AddAction } from './TreeCanvas'
import { formatDateTime } from '../../shared/i18n'
import { t } from '../i18n'

export type LinkKind = 'parent' | 'partner' | 'child' | 'sibling'

export interface InspectorProps {
  tree: TreeDocument
  index: TreeIndex
  person: Person
  focusRequest: { id: string; nonce: number } | null
  onFocusHandled: () => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onChange: (fields: Partial<PersonFields>, coalesceKey?: string) => void
  onCommit: () => void
  onFamilyChange: (familyId: string, fields: Partial<Pick<Family, 'marriageDate' | 'marriagePlace'>>, coalesceKey?: string) => void
  onAdd: (action: AddAction, familyId?: string) => void
  onLink: (kind: LinkKind, familyId?: string) => void
  onUnlink: (kind: LinkKind, otherId: string) => void
  onSelect: (id: string) => void
  onCenter: () => void
  onDelete: () => void
  onMerge: () => void
  onClose: () => void
  /** Review mode: when this person was verified (undefined = not yet); null when review mode is off. */
  review: { verifiedAt?: string } | null
  onVerify: (verified: boolean) => void
  onNextUnverified: () => void
  suggestions: { surnames: string[]; maleNames: string[]; femaleNames: string[]; places: string[] }
}

export function Inspector(props: InspectorProps) {
  const { tree, index, person, onChange, onCommit, onAdd, onLink, onUnlink, onSelect } = props
  const relatives = useMemo(() => relativesOf(tree, person.id, index), [tree, person.id, index])
  const givenRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const version = tree.gedcom.version

  useEffect(() => {
    if (props.focusRequest?.id !== person.id) return
    givenRef.current?.focus()
    givenRef.current?.select()
    props.onFocusHandled()
  }, [props.focusRequest, person.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const father = relatives.parents.map((id) => tree.people[id]).find((parent) => parent.sex === 'M')
  const suggestedPatronymic = father?.givenName && !person.patronymic ? patronymicFrom(father.givenName, person.sex) : ''
  const text = (key: keyof PersonFields & string, placeholder?: string, list?: string) => <TextInput
    name={key} value={person[key] as string} placeholder={placeholder} list={list}
    onChange={(value) => onChange({ [key]: value }, key)} onCommit={onCommit} />
  const parentageText = parentageLabel(tree, person.id, index)
  const hasFather = relatives.parentFamilies.some((family) => family.partnerIds.some((id) => tree.people[id].sex === 'M') || family.partnerIds.length >= 2)
  const hasMother = relatives.parentFamilies.some((family) => family.partnerIds.some((id) => tree.people[id].sex === 'F') || family.partnerIds.length >= 2)
  const childLabel = (sex: Sex) => t('relation.child', { sex })
  const partnerLabel = t('relation.partnerOf', { sex: person.sex })

  return <aside className="inspector" aria-label={t('inspector.label')}>
    <div className="inspector-head">
      <div className={`avatar sex-${person.sex}`}>{initials(person)}</div>
      <div className="inspector-title">
        <h2>{fullName(person)}</h2>
        <p>{[lifespan(person), parentageText].filter(Boolean).join(' · ') || t('person.noDetails')}</p>
      </div>
      <div className="inspector-head-actions">
        <button className="icon-btn sm" onClick={props.onBack} disabled={!props.canBack} aria-label={t('inspector.back')} title={t('inspector.backTitle')}><ChevronLeft size={16} /></button>
        <button className="icon-btn sm" onClick={props.onForward} disabled={!props.canForward} aria-label={t('inspector.forward')} title={t('inspector.forwardTitle')}><ChevronRight size={16} /></button>
        <button className="icon-btn sm" onClick={props.onCenter} aria-label={t('inspector.center')} title={t('inspector.centerTitle')}><Crosshair size={16} /></button>
        <button className="icon-btn sm" onClick={props.onClose} aria-label={t('inspector.close')} title={t('inspector.closeTitle')}><X size={16} /></button>
      </div>
    </div>

    {props.review && (props.review.verifiedAt
      ? <div className="verify-bar ok">
        <span className="status"><span className="status-dot ok" />{t('review.verified')}<small>{formatDateTime(props.review.verifiedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span>
        <button className="btn btn-ghost btn-sm" onClick={() => props.onVerify(false)} title={t('review.unmarkTitle')}><Undo2 size={14} />{t('review.unmark')}</button>
        <button className="btn btn-secondary btn-sm" onClick={props.onNextUnverified} title={t('review.nextTitle')}>{t('review.next')}<ArrowRight size={14} /></button>
      </div>
      : <div className="verify-bar todo">
        <span className="status"><span className="status-dot todo" />{t('review.unverified')}</span>
        <button className="btn btn-ok btn-sm" onClick={() => props.onVerify(true)} title={t('review.markTitle')}><Check size={14} />{t('review.mark')}</button>
      </div>)}

    <div className="inspector-body">
      <section className="section">
        <Field label={t('fields.surname')}>{text('surname', t('fields.surname'), 'dl-surnames')}</Field>
        <div className="grid-2">
          <Field label={t('fields.givenName')}><TextInput ref={givenRef} name="givenName" value={person.givenName} placeholder={t('fields.givenName')} list={person.sex === 'F' ? 'dl-female' : 'dl-male'} onChange={(value) => onChange({ givenName: value }, 'givenName')} onCommit={onCommit} /></Field>
          <Field label={t('fields.patronymic')} extra={suggestedPatronymic && <button type="button" className="suggestion" onClick={(event) => { event.preventDefault(); onChange({ patronymic: suggestedPatronymic }, 'patronymic'); onCommit() }} title={t('fields.patronymicSuggestion')}>{suggestedPatronymic}?</button>}>
            {text('patronymic', t('fields.patronymic'))}
          </Field>
        </div>
        {(person.sex !== 'M' || person.birthSurname) && <Field label={t('fields.birthSurname', { sex: person.sex })}>{text('birthSurname', t('fields.birthSurnamePlaceholder'), 'dl-surnames')}</Field>}
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('fields.sex')}</span>
          <Segmented label={t('fields.sex')} value={person.sex} onChange={(sex) => { onChange({ sex }); onCommit() }}
            options={[{ value: 'M', label: t('fields.male'), className: 'male' }, { value: 'F', label: t('fields.female'), className: 'female' }, { value: 'U', label: t('fields.unknownSex') }]} />
        </div>
      </section>

      <section className="section">
        <h3 className="section-title">{t('inspector.birth')}</h3>
        <div className="grid-2">
          <Field label={t('fields.date')}><DateInput name="birthDate" value={person.birthDate} version={version} onCommit={(value) => { onChange({ birthDate: value }); onCommit() }} /></Field>
          <Field label={t('fields.place')}>{text('birthPlace', t('fields.placePlaceholder'), 'dl-places')}</Field>
        </div>
      </section>

      <section className="section">
        <h3 className="section-title">{t('inspector.death')}</h3>
        <div className="grid-2">
          <Field label={t('fields.date')}><DateInput name="deathDate" value={person.deathDate} version={version} placeholder={t('fields.deathDatePlaceholder')} onCommit={(value) => { onChange({ deathDate: value }); onCommit() }} /></Field>
          <Field label={t('fields.place')}>{text('deathPlace', t('fields.placePlaceholder'), 'dl-places')}</Field>
        </div>
      </section>

      <section className="section">
        <Field label={t('fields.note')}><TextInput name="note" multiline value={person.note} placeholder={t('fields.notePlaceholder')} onChange={(value) => onChange({ note: value }, 'note')} onCommit={onCommit} /></Field>
      </section>

      <section className="section">
        <h3 className="section-title">{t('inspector.parents')}</h3>
        <div className="relative-list">
          {relatives.parents.map((id) => <RelativeRow key={id} person={tree.people[id]} onSelect={onSelect} onRemove={() => onUnlink('parent', id)} removeLabel={t('inspector.unlinkParent')} />)}
        </div>
        {!relatives.parents.length && <p className="muted">{person.patronymic && fatherNameFromPatronymic(person.patronymic) ? t('inspector.noParentsFather', { father: fatherNameFromPatronymic(person.patronymic) }) : t('inspector.noParents')}</p>}
        <div className="add-row">
          {!hasFather && <button className="btn btn-secondary btn-sm" onClick={() => onAdd('father')}><Plus size={14} />{t('relation.father')}</button>}
          {!hasMother && <button className="btn btn-secondary btn-sm" onClick={() => onAdd('mother')}><Plus size={14} />{t('relation.mother')}</button>}
          {!(hasFather && hasMother) && <button className="btn btn-ghost btn-sm" onClick={() => onLink('parent')}><Link2 size={14} />{t('inspector.pickFromTree')}</button>}
        </div>
      </section>

      <section className="section">
        <h3 className="section-title">{t('inspector.families')}</h3>
        {relatives.partnerFamilies.map((family) => {
          const partnerId = family.partnerIds.find((id) => id !== person.id)
          return <div className="family-card" key={family.id}>
            <div className="family-card-head"><span>{partnerId ? partnerLabel : t('family.noSecondParent')}</span></div>
            {partnerId ? <RelativeRow person={tree.people[partnerId]} onSelect={onSelect} onRemove={() => onUnlink('partner', partnerId)} removeLabel={t('inspector.unlinkPartner')} />
              : <div className="add-row" style={{ marginTop: 2 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => onAdd('partner', family.id)}><Plus size={14} />{partnerLabel}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onLink('partner', family.id)}><Link2 size={14} />{t('inspector.pickFromTree')}</button>
              </div>}
            {partnerId && <div className="grid-2" style={{ marginTop: 6 }}>
              <Field label={t('fields.marriageDate')}><DateInput value={family.marriageDate} version={version} placeholder={t('fields.marriageDatePlaceholder')} onCommit={(value) => { props.onFamilyChange(family.id, { marriageDate: value }); onCommit() }} /></Field>
              <Field label={t('fields.marriagePlace')}><TextInput value={family.marriagePlace} list="dl-places" placeholder={t('fields.placePlaceholder')} onChange={(value) => props.onFamilyChange(family.id, { marriagePlace: value }, `${family.id}:marriagePlace`)} onCommit={onCommit} /></Field>
            </div>}
            <div className="children-label">{t('inspector.children')}{family.childIds.length ? ` · ${family.childIds.length}` : ''}</div>
            <div className="relative-list">
              {family.childIds.map((id) => <RelativeRow key={id} person={tree.people[id]} subtitle={childLabel(tree.people[id].sex)} onSelect={onSelect} onRemove={() => onUnlink('child', id)} removeLabel={t('inspector.unlinkChild')} />)}
            </div>
            <div className="add-row">
              <button className="btn btn-secondary btn-sm" onClick={() => onAdd('son', family.id)}><Plus size={14} />{t('relation.son')}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => onAdd('daughter', family.id)}><Plus size={14} />{t('relation.daughter')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onLink('child', family.id)}><Link2 size={14} />{t('inspector.pickFromTree')}</button>
            </div>
          </div>
        })}
        {!relatives.partnerFamilies.length && <p className="muted">{t('inspector.noFamilies')}</p>}
        <div className="add-row">
          <button className="btn btn-secondary btn-sm" onClick={() => onAdd('partner')}><Plus size={14} />{relatives.partnerFamilies.length ? t('inspector.anotherMarriage') : partnerLabel}</button>
          {!relatives.partnerFamilies.length && <>
            <button className="btn btn-secondary btn-sm" onClick={() => onAdd('son')}><Plus size={14} />{t('relation.son')}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onAdd('daughter')}><Plus size={14} />{t('relation.daughter')}</button>
          </>}
          <button className="btn btn-ghost btn-sm" onClick={() => onLink('partner')}><Link2 size={14} />{t('inspector.partnerFromTree')}</button>
        </div>
      </section>

      <section className="section">
        <h3 className="section-title">{t('inspector.siblings')}</h3>
        <div className="relative-list">
          {relatives.siblings.map((id) => <RelativeRow key={id} person={tree.people[id]} subtitle={tree.people[id].sex === 'U' ? undefined : t('relation.sibling', { sex: tree.people[id].sex })} onSelect={onSelect} onRemove={() => onUnlink('sibling', id)} removeLabel={t('inspector.unlink')} />)}
        </div>
        {!relatives.siblings.length && <p className="muted">{t('inspector.noSiblings')}</p>}
        <div className="add-row">
          <button className="btn btn-secondary btn-sm" onClick={() => onAdd('brother')}><Plus size={14} />{t('relation.brother')}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAdd('sister')}><Plus size={14} />{t('relation.sister')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onLink('sibling')}><Link2 size={14} />{t('inspector.pickFromTree')}</button>
        </div>
      </section>

      <div className="danger-zone">
        <span className="meta-id">{t('inspector.gedcomId', { id: person.id })}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={props.onMerge} title={t('inspector.mergeTitle')}><Combine size={14} />{t('inspector.merge')}</button>
          <button className="btn btn-danger btn-sm" onClick={props.onDelete}><Trash2 size={14} />{t('inspector.delete')}</button>
        </span>
      </div>
    </div>
  </aside>
}

function RelativeRow({ person, subtitle, onSelect, onRemove, removeLabel }: { person: Person; subtitle?: string; onSelect: (id: string) => void; onRemove: () => void; removeLabel: string }) {
  const years = lifespan(person)
  return <div className="relative-row">
    <button className="relative-main" onClick={() => onSelect(person.id)}>
      <span className={`avatar sm sex-${person.sex}`}>{initials(person)}</span>
      <span style={{ minWidth: 0 }}><strong>{fullName(person)}</strong><small>{[subtitle, years].filter(Boolean).join(' · ') || ' '}</small></span>
    </button>
    <button className="icon-btn sm" onClick={onRemove} aria-label={removeLabel} title={removeLabel}><X size={14} /></button>
  </div>
}
