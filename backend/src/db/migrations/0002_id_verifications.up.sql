-- ID verification: both Renters and Customers upload NIN slip / International Passport /
-- Voter's Card (PVC). Verified via a provider-agnostic interface - see
-- src/modules/idVerification. document-validation only, no biometric/liveness matching.

CREATE TYPE id_document_type AS ENUM ('nin', 'passport', 'pvc');
CREATE TYPE id_verification_status AS ENUM ('pending', 'verified', 'failed');

CREATE TABLE id_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document_type id_document_type NOT NULL,
  document_number TEXT NOT NULL,
  status id_verification_status NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL, -- e.g. 'prembly' or 'mock'
  provider_reference TEXT,
  cost_naira NUMERIC(10, 2) NOT NULL DEFAULT 0, -- absorbed by TalcTech, not charged to the user
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_id_verifications_user_id ON id_verifications (user_id);
