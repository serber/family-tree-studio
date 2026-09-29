import { GitFork } from 'lucide-react'

/** The product logo: a fork of lines in an accent square. */
export function BrandMark({ size = 15 }: { size?: number }) {
  return <span className="brand-mark" aria-hidden="true"><GitFork size={size} /></span>
}
