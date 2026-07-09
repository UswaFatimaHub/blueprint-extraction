export type DocumentStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type DocumentPhase = 'queued' | 'convert' | 'extract' | 'merge' | 'done'
export type FieldStatus = 'unverified' | 'verified' | 'corrected'
export type MatchQuality = 'anchor' | 'word' | 'line' | 'block' | 'none'

export interface BBox {
  x: number
  y: number
  w: number
  h: number
  page?: number | null
}

export interface Correction {
  id: number
  field_id: number | null
  document_id: string
  document_name: string
  field_key: string
  field_label: string
  original_value: string | null
  corrected_value: string
  reason: string
  category: string
  page: number | null
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  created_at: string
}

export interface FieldLocation {
  page: number
  x: number
  y: number
  w: number
  h: number
  q: string
  /** OCR confidence at this specific occurrence (null for anchors / region fallbacks) */
  conf?: number | null
}

export interface ExtractedField {
  id: number
  field_key: string
  label: string
  value: string | null
  confidence: number | null
  page: number | null
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  /** every occurrence of the value on the document, primary first */
  locations?: FieldLocation[]
  match_quality: MatchQuality
  source_text: string | null
  ai_reasoning: string | null
  status: FieldStatus
  corrected_value: string | null
  sort_order: number
  correction: Correction | null
}

export interface Document {
  id: string
  filename: string
  status: DocumentStatus
  phase: DocumentPhase
  error: string | null
  page_count: number | null
  part_number: string | null
  part_type_id: number | null
  part_type_name: string | null
  created_at: string
  processed_at: string | null
  fields_total: number
  fields_verified: number
  fields_corrected: number
  avg_confidence: number | null
}

export interface DocumentDetail extends Document {
  extraction_id: number | null
  prompt_version_label: string | null
  parse_quality_score: number | null
  fields: ExtractedField[]
}

export interface FieldDefinition {
  id: number
  key: string
  label: string
  description: string
  example: string
  sort_order: number
  active: boolean
}

export interface FieldDefinitionInput {
  id?: number | null
  key: string
  label: string
  description: string
  example: string
  active: boolean
}

export interface PartType {
  id: number
  name: string
  description: string
  created_at: string
  fields: FieldDefinition[]
}

export interface StandardRule {
  id: number
  title: string
  rule: string
  context: string
  active: boolean
  sort_order: number
  updated_at: string
}

export interface PromptVersion {
  id: number
  version_number: number
  label: string
  notes: string
  created_at: string
  documents_processed: number
  fields_reviewed: number
  accuracy: number | null
}

export interface PromptPreview {
  part_type_id: number
  part_type_name: string
  prompt_text: string
  page_schema: Record<string, unknown>
}

export interface ErrorPattern {
  field_key: string
  field_label: string
  count: number
  last_reason: string
  categories: string[]
}

export interface VersionAccuracy {
  id: number
  label: string
  created_at: string
  fields_reviewed: number
  accuracy: number | null
}

export interface DashboardStats {
  documents_total: number
  documents_completed: number
  documents_failed: number
  fields_total: number
  fields_verified: number
  fields_corrected: number
  fields_unverified: number
  corrections_total: number
  overall_accuracy: number | null
  avg_confidence: number | null
}

export interface DashboardData {
  stats: DashboardStats
  error_patterns: ErrorPattern[]
  version_accuracy: VersionAccuracy[]
  recent_corrections: Correction[]
}

export interface Meta {
  mode: 'real' | 'mock'
  extraction_mode: string
  has_api_key: boolean
}
