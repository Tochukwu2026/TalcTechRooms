-- Core enums and the users table. Every account (Renter, Customer, Admin, Staff) is a row
-- here; role-specific detail lives in renters / customers tables (0004).

CREATE TYPE user_role AS ENUM ('renter', 'customer', 'admin', 'staff');

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  role user_role NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);
