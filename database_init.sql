-- =================================================================
-- 视频会议管理后台 - 统一数据库脚本（二合一）
-- 用途：
-- 1) 新库初始化（建核心表）
-- 2) 老库兼容迁移（补 invite_codes 新增字段）
-- 在 Supabase SQL Editor 中整段执行
-- =================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 邀请码表（核心）
CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  room_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  ttl_seconds INTEGER NOT NULL,
  max_participants INTEGER NOT NULL DEFAULT 2,
  assigned_to BIGINT,
  assigned_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

-- 兼容旧库：若历史表缺少字段则补齐
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS assigned_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

UPDATE invite_codes
SET assigned_name = ''
WHERE assigned_name IS NULL;

UPDATE invite_codes
SET note = ''
WHERE note IS NULL;

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at);

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON invite_codes;
CREATE POLICY "service_role_all" ON invite_codes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. 健康状态表
CREATE TABLE IF NOT EXISTS health_state (
  id TEXT PRIMARY KEY,
  healthy BOOLEAN NOT NULL DEFAULT true,
  active_primary BOOLEAN NOT NULL DEFAULT true,
  last_checked TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE health_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON health_state;
CREATE POLICY "service_role_all" ON health_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. 应用配置表
CREATE TABLE IF NOT EXISTS app_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON app_config;
CREATE POLICY "service_all" ON app_config FOR ALL USING (true) WITH CHECK (true);

-- 4. 管理员表
CREATE TABLE IF NOT EXISTS tg_admins (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tg_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON tg_admins;
CREATE POLICY "service_all" ON tg_admins FOR ALL USING (true) WITH CHECK (true);

-- 默认配置（精简 + 兼容）
INSERT INTO app_config (key, value) VALUES
  ('api_url', ''),
  ('api_url_main', ''),
  ('api_url_backup', ''),
  ('api_secret', ''),
  ('api_key', ''),
  ('console_username', ''),
  ('console_password', ''),
  ('usage_instructions', '平台使用说明\n\n1. 购买后授权码会进入当前分组\n2. 授权码从第一次进入会议开始计时，有效时间 12 小时\n3. 授权码一码一房间，会议结束后可再次开设房间'),
  ('customer_service', '@yunjihuiyi_support'),
  ('purchase_notice', '使用说明\n\n1. 授权码从第一次进入会议开始计时\n2. 授权码一码一房间\n3. 会议结束后可再次开设房间')
ON CONFLICT (key) DO NOTHING;

-- 5. 聊天记录表
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  room_name TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_name);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all" ON chat_messages;
CREATE POLICY "service_all" ON chat_messages FOR ALL USING (true) WITH CHECK (true);

-- =================================================================
-- 说明：
-- 1. 本脚本不再创建已下线的 payment/bot 相关表。
-- 2. 若数据库里已有这些旧表，会保留，不影响当前系统运行。
-- =================================================================
