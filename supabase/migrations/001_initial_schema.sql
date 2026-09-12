-- SmartForm AI: PostgreSQL Schema for Supabase
-- Cyber Café Government Form Assistant Database Schema

-- 1. Applications table: Top-level government form filing task
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_url TEXT NOT NULL,
    portal_name TEXT,
    operator_notes TEXT,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'analyzing', 'waiting_documents', 'processing', 'ready_for_review', 'completed', 'purged')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
    purged_at TIMESTAMPTZ
);

-- 2. Form Sessions table: Active browser & extension inspection session
CREATE TABLE IF NOT EXISTS form_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    tab_id INTEGER,
    form_url TEXT NOT NULL,
    form_title TEXT,
    extension_connected BOOLEAN NOT NULL DEFAULT FALSE,
    raw_dom_summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Form Fields table: Detected input elements from target government form
CREATE TABLE IF NOT EXISTS form_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES form_sessions(id) ON DELETE CASCADE,
    field_type TEXT NOT NULL,
    label TEXT,
    name TEXT,
    dom_id TEXT,
    selector TEXT NOT NULL,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    placeholder TEXT,
    autocomplete TEXT,
    aria_label TEXT,
    nearby_text TEXT,
    options JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Document Requirements table: Specific documents required by the form
CREATE TABLE IF NOT EXISTS document_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL, -- e.g., '10th Marksheet', 'Identity Proof'
    description TEXT,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'verified', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Upload Sessions table: Single-purpose secure token linked to one document requirement
CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id UUID NOT NULL REFERENCES document_requirements(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    upload_token TEXT NOT NULL UNIQUE,
    expected_document_type TEXT NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Documents table: Uploaded temporary document metadata
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_session_id UUID NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    detected_document_type TEXT,
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'inconclusive')),
    rejection_reason TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Extracted Data table: Information extracted from verified documents
CREATE TABLE IF NOT EXISTS extracted_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    field_value TEXT NOT NULL,
    source_document TEXT NOT NULL,
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.000,
    purged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Field Mappings table: Match between extracted data and actual form fields
CREATE TABLE IF NOT EXISTS field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    target_field_name TEXT NOT NULL,
    target_field_id TEXT,
    target_selector TEXT NOT NULL,
    extracted_field_key TEXT,
    assigned_value TEXT,
    source_document TEXT,
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.000,
    status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'manual_required', 'attention_required', 'confirmed', 'corrected')),
    is_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Verification Results table: Operator verification check results
CREATE TABLE IF NOT EXISTS verification_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    total_fields INTEGER NOT NULL,
    auto_filled_count INTEGER NOT NULL,
    manual_attention_count INTEGER NOT NULL,
    verified_by_operator BOOLEAN NOT NULL DEFAULT FALSE,
    operator_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Learning Feedback table: Anonymized feedback for field mapping refinement
CREATE TABLE IF NOT EXISTS learning_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_domain TEXT NOT NULL,
    field_label TEXT NOT NULL,
    field_name TEXT,
    ai_predicted_mapping TEXT,
    operator_confirmed_mapping TEXT NOT NULL,
    was_corrected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Processing Logs table: Operational and audit logs (no sensitive PII)
CREATE TABLE IF NOT EXISTS processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_token ON upload_sessions(upload_token);
CREATE INDEX IF NOT EXISTS idx_doc_reqs_app ON document_requirements(application_id);
CREATE INDEX IF NOT EXISTS idx_mappings_app ON field_mappings(application_id);
