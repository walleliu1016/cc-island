-- Migration: 005_add_broadcast_direction.sql
-- Purpose: Add broadcast_to_desktop to direction CHECK constraint

-- Drop old constraint
ALTER TABLE pending_messages DROP CONSTRAINT pending_messages_direction_check;

-- Add new constraint with broadcast_to_desktop
ALTER TABLE pending_messages ADD CONSTRAINT pending_messages_direction_check
    CHECK (direction IN ('to_mobile', 'to_desktop', 'broadcast_to_desktop'));