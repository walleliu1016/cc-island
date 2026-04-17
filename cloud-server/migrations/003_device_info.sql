-- migrations/003_device_info.sql
-- Add hostname and registered_at fields to devices table

ALTER TABLE devices ADD COLUMN hostname TEXT;
ALTER TABLE devices ADD COLUMN registered_at TIMESTAMPTZ;

-- Update existing devices with default registered_at if null
UPDATE devices SET registered_at = created_at WHERE registered_at IS NULL;

-- Add index for hostname lookup
CREATE INDEX idx_devices_hostname ON devices(hostname);