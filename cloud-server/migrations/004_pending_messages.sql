-- Migration: 004_pending_messages.sql
-- Purpose: Store cross-instance messages for NOTIFY-based routing

CREATE TABLE pending_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to_mobile', 'to_desktop')),
    message_type TEXT NOT NULL,
    message_body JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient lookup by device and direction
CREATE INDEX idx_pending_device_direction
    ON pending_messages(device_token, direction, created_at);

-- Index for cleanup by timestamp
CREATE INDEX idx_pending_created_at
    ON pending_messages(created_at);