import type { GedcomSource } from './types'

/**
 * Minimal valid GEDCOM 5.5.1 file used as the source of documents created in the app.
 * New people and families are exported as structural insertions into this skeleton,
 * so created and imported documents share one export path.
 */
export function createSkeleton(fileName = 'family-tree.ged'): GedcomSource {
  const text = [
    '0 HEAD',
    '1 SOUR FAMILY_TREE_STUDIO',
    '2 NAME Family Tree Studio',
    '1 SUBM @U1@',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    '0 @U1@ SUBM',
    '1 NAME Family Tree Studio',
    '0 TRLR',
    '',
  ].join('\n')
  return { text, fileName, version: '5.5.1', encoding: 'UTF-8', warnings: [] }
}
