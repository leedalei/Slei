CREATE TABLE IF NOT EXISTS agent_role_preset_categories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO agent_role_preset_categories(id, title, sort_order, enabled)
VALUES
    ('market-content', '市场内容', 10, 1),
    ('research-analysis', '研究分析', 20, 1),
    ('product-design', '产品设计', 30, 1),
    ('engineering', '研发技术', 40, 1),
    ('quality', '质量审查', 50, 1),
    ('education', '教育培训', 60, 1),
    ('legal-finance', '法务财务', 70, 1),
    ('operations', '运营管理', 80, 1),
    ('general', '通用职能', 90, 1);

CREATE INDEX IF NOT EXISTS idx_agent_role_preset_categories_enabled_sort
    ON agent_role_preset_categories(enabled, sort_order, title);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (13);
