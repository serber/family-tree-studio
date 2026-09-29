import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import { formatDate, parseDateInput, type GedcomVersion } from '../model/dates'
import { useLocale } from '../../shared/i18n/react'
import { t } from '../i18n'

export function Field({ label, hint, children, extra }: { label: string; hint?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return <label className="field">
    <span className="field-label">{label}{extra}</span>
    {children}
    {hint}
  </label>
}

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: () => void
  placeholder?: string
  list?: string
  name?: string
  multiline?: boolean
}

/** Text input that reports every change (callers coalesce undo steps) and commits on blur/Enter. */
export const TextInput = forwardRef<HTMLInputElement & HTMLTextAreaElement, TextInputProps>(function TextInput({ value, onChange, onCommit, placeholder, list, name, multiline }, ref) {
  if (multiline) {
    return <textarea ref={ref} className="input" name={name} value={value} placeholder={placeholder} rows={3}
      onChange={(event) => onChange(event.target.value)} onBlur={onCommit} />
  }
  return <input ref={ref} className="input" name={name} value={value} placeholder={placeholder} list={list} autoComplete="off" spellCheck={false}
    onChange={(event) => onChange(event.target.value)} onBlur={onCommit}
    onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur() } }} />
})

/**
 * Accepts free-text dates ("ок. 1900", "12.03.1900", "до 1917", "5 мая 1880 ст. ст.", "abt. 1900") and stores GEDCOM values.
 * Shows how the input was understood before committing on blur or Enter; Escape reverts.
 */
export function DateInput({ value, onCommit, version, name, placeholder = t('fields.datePlaceholder') }: { value: string; onCommit: (value: string) => void; version: GedcomVersion; name?: string; placeholder?: string }) {
  const [text, setText] = useState(() => formatDate(value))
  const [focused, setFocused] = useState(false)
  const locale = useLocale()
  useEffect(() => { if (!focused) setText(formatDate(value)) }, [value, focused, locale])
  const parsed = parseDateInput(text, version)
  const changed = parsed.value !== value
  const hint = !text.trim() ? '' : !parsed.recognized ? t('fields.dateUnrecognized') : focused && changed ? `→ ${formatDate(parsed.value)}` : ''
  const commit = () => { if (changed) onCommit(parsed.value) }
  return <>
    <input className={`input ${text.trim() && !parsed.recognized ? 'invalid' : ''}`} name={name} value={text} placeholder={placeholder} autoComplete="off" spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit() }}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setText(formatDate(value)); event.stopPropagation(); requestAnimationFrame(() => event.currentTarget?.blur()) }
      }} />
    <span className={`field-hint ${!parsed.recognized && text.trim() ? 'warn' : 'ok'}`}>{hint}</span>
  </>
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; className?: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" className={option.className} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
}
