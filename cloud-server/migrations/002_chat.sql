-- migrations/002_chat.sql
-- Chat messages table for conversation history sync

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_token TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,  -- Original UUID from desktop
    message_type TEXT NOT NULL, -- user/assistant/toolCall/toolResult/thinking
    content TEXT NOT NULL,
    tool_name TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(device_token, session_id, message_id)
);

CREATE INDEX idx_chat_session ON chat_messages(device_token, session_id, timestamp);
CREATE INDEX idx_chat_device ON chat_messages(device_token);