-- migrations/001_init.sql

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT UNIQUE NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'offline',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL REFERENCES devices(device_token),
    session_id TEXT NOT NULL,
    project_name TEXT,
    status TEXT NOT NULL,
    current_tool TEXT,
    tool_input JSONB,
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(device_token, session_id)
);

CREATE TABLE popups (
    id TEXT PRIMARY KEY,
    device_token TEXT NOT NULL REFERENCES devices(device_token),
    session_id TEXT,
    project_name TEXT,
    popup_type TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_popups_device_status ON popups(device_token, status);