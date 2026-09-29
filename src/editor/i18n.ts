import { AppError } from '../shared/errors'
import { scoped } from '../shared/i18n'

/** The editor's strings live under the `editor` namespace of the product catalog. */
export const t = scoped('editor')

/** User-facing text for any thrown value: coded errors are translated, others keep their message. */
export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return t(`errors.${error.code}`, error.params)
  if (error instanceof Error && error.message) return error.message
  return t('errors.unknown')
}
